# Building ArtistGrid for Android

Technical notes for anyone working on the code. To just install the app, see the [README](../README.md).

## How it works

It is a [Capacitor](https://capacitorjs.com) app: the interface is plain HTML/CSS/JavaScript in [`www/`](../www), with no framework and no build step. Data comes from:

| Data | Endpoint |
| --- | --- |
| Artist list | `https://artists.artistgrid.cx/artists.csv` |
| Trackers | `https://trackerapi.artistgrid.cx/sh/<id>/` · `/sh/<id>/tab/<tab>` |
| Artist photos | `https://assets.artistgrid.cx/webp/<name>.webp` |
| Audio | pillows.su, pixeldrain and Google Drive links, resolved the same way as on the site |
| Fallback covers | `https://itunes.apple.com/search` · `https://api.deezer.com/search/{artist,album}` |

Requests go through Capacitor's native HTTP client (`CapacitorHttp`), so the app does not depend on CORS rules. Downloaded trackers are stored in IndexedDB for offline use.

Audio and covers that fail to load directly are requested through `/_proxy?u=<url>`, which [`ProxyWebViewClient`](../android/app/src/main/java/cx/artistgrid/app/ProxyWebViewClient.java) serves natively (no referrer, Range requests forwarded). Because proxied audio is same-origin, the Web Audio equalizer can process it.

## Builds and releases

Every push builds a debug APK with GitHub Actions (`.github/workflows/build-apk.yml`). Running the workflow manually with a version (e.g. `1.2.0`) also publishes a GitHub release with `ArtistGrid.apk` and the notes in `.github/release-notes.md`; the app's update check reads the latest release.

To sign every build with the same key (so new versions install as updates), add these repository secrets:

| Secret | Value |
| --- | --- |
| `SIGNING_KEYSTORE` | the keystore file, base64-encoded (`base64 -w0 my.keystore`) |
| `SIGNING_PASSWORD` | the keystore and key password |
| `SIGNING_ALIAS` | the key alias (defaults to `artistgrid`) |

Create a keystore with `keytool -genkeypair -keystore my.keystore -alias artistgrid -keyalg RSA -keysize 2048 -validity 10000`.

## Building from source

Requirements: Node.js 18+, JDK 21, Android SDK (platform 35, build-tools 35).

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`.

> On Windows, Gradle can fail if the project sits in a very long path. If that happens, move it to a short folder such as `C:\dev\artistgrid-android`.

To try the interface in a browser during development:

```bash
python -m http.server 8765 -d www
```
