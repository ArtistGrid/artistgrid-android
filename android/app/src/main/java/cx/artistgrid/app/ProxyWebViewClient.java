package cx.artistgrid.app;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Answers requests to the app's own origin at /_proxy?u=<remote url> by fetching the remote
 * file natively and streaming it back.
 *
 * - Audio served this way is same-origin for the web layer, so Web Audio (the equalizer) can
 *   process it. Range requests are forwarded so seeking keeps working.
 * - Images are fetched without a Referer header, which rescues covers whose hosts block
 *   hotlinking from the app's origin.
 * - With c=1 (covers), successful images are kept on disk, so a cover downloads once and then
 *   opens instantly, also offline.
 */
public class ProxyWebViewClient extends BridgeWebViewClient {

    private static final String PATH = "/_proxy";
    private static final int MAX_REDIRECTS = 6;
    private static final String[] PASS_HEADERS = { "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag" };

    private static final long COVER_CACHE_MAX = 200L * 1024 * 1024;
    private static final int COVER_MAX_BYTES = 8 * 1024 * 1024;

    private final String host;
    private final String userAgent;
    private final File coverDir;

    public ProxyWebViewClient(Bridge bridge) {
        super(bridge);
        host = bridge.getHost();
        // read on the UI thread: WebView methods can't be called from the request thread
        userAgent = bridge.getWebView().getSettings().getUserAgentString();
        coverDir = new File(bridge.getContext().getFilesDir(), "covers");
        coverDir.mkdirs();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (PATH.equals(uri.getPath()) && host != null && host.equals(uri.getHost())) {
            String target = uri.getQueryParameter("u");
            if (target != null && (target.startsWith("https://") || target.startsWith("http://"))) {
                if ("1".equals(uri.getQueryParameter("c"))) return cachedImage(target, request.getRequestHeaders());
                return fetch(target, request.getRequestHeaders());
            }
            return error(400, "Bad Request");
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse fetch(String target, Map<String, String> requestHeaders) {
        String range = header(requestHeaders, "Range");
        HttpURLConnection conn = null;
        try {
            URL url = new URL(target);
            for (int i = 0; ; i++) {
                conn = (HttpURLConnection) url.openConnection();
                conn.setInstanceFollowRedirects(false); // follow manually: also across http/https
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setRequestProperty("User-Agent", userAgent);
                conn.setRequestProperty("Accept", "*/*");
                if (range != null) conn.setRequestProperty("Range", range);
                int code = conn.getResponseCode();
                if (code < 300 || code >= 400) break;
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || i >= MAX_REDIRECTS) return error(502, "Bad Gateway");
                url = new URL(url, location);
            }

            int code = conn.getResponseCode();
            InputStream body = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (body == null) body = new ByteArrayInputStream(new byte[0]);

            String mime = "application/octet-stream";
            String charset = null;
            String type = conn.getContentType();
            if (type != null) {
                String[] parts = type.split(";");
                mime = parts[0].trim();
                for (String p : parts) {
                    p = p.trim();
                    if (p.toLowerCase().startsWith("charset=")) charset = p.substring(8);
                }
            }

            Map<String, String> headers = new HashMap<>();
            for (String name : PASS_HEADERS) {
                String value = conn.getHeaderField(name);
                if (value != null) headers.put(name, value);
            }
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");

            String reason = conn.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = code < 400 ? "OK" : "Error";
            return new WebResourceResponse(mime, charset, code, reason, headers, body);
        } catch (Exception e) {
            if (conn != null) conn.disconnect();
            return error(502, "Bad Gateway");
        }
    }

    /** Serves an image from the disk cache, downloading and storing it on the first request. */
    private WebResourceResponse cachedImage(String target, Map<String, String> requestHeaders) {
        String key = sha1(target);
        File body = new File(coverDir, key);
        File type = new File(coverDir, key + ".type");
        if (body.isFile() && type.isFile()) {
            try {
                String mime = readSmall(type);
                body.setLastModified(System.currentTimeMillis()); // keeps recently used covers in the cache
                Map<String, String> headers = new HashMap<>();
                headers.put("Access-Control-Allow-Origin", "*");
                return new WebResourceResponse(mime, null, 200, "OK", headers, new FileInputStream(body));
            } catch (Exception ignored) {}
        }
        WebResourceResponse res = fetch(target, requestHeaders);
        String mime = res.getMimeType();
        if (res.getStatusCode() != 200 || mime == null || !mime.startsWith("image/") || res.getData() == null) return res;
        try (InputStream in = res.getData()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                total += n;
                if (total > COVER_MAX_BYTES) return error(502, "Too Large");
            }
            byte[] bytes = out.toByteArray();
            try (FileOutputStream f = new FileOutputStream(body)) { f.write(bytes); }
            try (FileOutputStream f = new FileOutputStream(type)) { f.write(mime.getBytes("UTF-8")); }
            trimCache();
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(mime, null, 200, "OK", headers, new ByteArrayInputStream(bytes));
        } catch (Exception e) {
            body.delete();
            return error(502, "Bad Gateway");
        }
    }

    /** Drops the least recently used covers once the cache is over its size limit. */
    private void trimCache() {
        File[] files = coverDir.listFiles((d, name) -> !name.endsWith(".type"));
        if (files == null) return;
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= COVER_CACHE_MAX) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        for (File f : files) {
            if (total <= COVER_CACHE_MAX * 3 / 4) break;
            total -= f.length();
            f.delete();
            new File(coverDir, f.getName() + ".type").delete();
        }
    }

    private static String sha1(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private static String readSmall(File f) throws Exception {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) Math.min(f.length(), 256)];
            int n = in.read(b);
            return new String(b, 0, Math.max(n, 0), "UTF-8").trim();
        }
    }

    private static String header(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> h : headers.entrySet()) {
            if (h.getKey() != null && h.getKey().equalsIgnoreCase(name)) return h.getValue();
        }
        return null;
    }

    private static WebResourceResponse error(int code, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", code, reason, headers, new ByteArrayInputStream(new byte[0]));
    }
}
