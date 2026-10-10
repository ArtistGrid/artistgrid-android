package cx.artistgrid.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePlugin.class);
        super.onCreate(savedInstanceState);
        // Serves /_proxy?u=… so covers and audio can be fetched natively (see ProxyWebViewClient).
        bridge.setWebViewClient(new ProxyWebViewClient(bridge));

        // The system Back gesture walks back through the app's pages (artist → list) before
        // leaving the app, instead of closing it right away.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = bridge.getWebView();
                if (webView != null && webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }
}
