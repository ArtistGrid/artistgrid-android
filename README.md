# ArtistGrid for Android

An **unofficial** Android app for [ArtistGrid](https://artistgrid.cx), the collection of unreleased music trackers.
Browse artists, explore trackers era by era and listen to tracks right from your phone, with an interface built for mobile.

> This project is not affiliated with ArtistGrid. All data comes from the site's public APIs, and the trackers belong to their respective authors, who are credited in the app.

## Features

- **Artist grid**: 580+ artists with photos and instant search.
- **Bottom navigation**: a floating "liquid glass" tab bar (Artists, Top, Updated, Favorites) within thumb reach, with a glass mini-player above it.
- **Language**: the interface follows the phone's language (English, Italiano, Español, Français, Deutsch, Português; English is the fallback), or can be picked in Settings.
- **Settings**: 5-band equalizer with presets, autoplay and playback speed, compact grid, reduced animations, offline cache and update checks.
- **Sticky header**: the title and search stay visible while scrolling artists; on an artist page the photo, name, search, filter menu and tracker sections stay pinned too.
- **Cover lookup**: missing or broken covers and artist photos are looked up on Apple Music (iTunes Search API) and Deezer, accepting only results whose artist name matches.
- **Full trackers**: every tab (Unreleased, Released, Recent, Best Of, Stems…), with eras, cover art, descriptions and stats.
- **Track details**: quality, available length, leak date, credits, notes and links.
- **Track search**: search the whole tracker by title, notes or era, with *Playable*, *Full* and *Snippet* filters.
- **Built-in player**: play/pause, previous/next and a progress bar. When a track ends, the next one in the era starts.
- **Favorites**: save the artists you follow.
- **Offline use**: trackers you have already opened stay available without a connection, and a copy of the artist list ships with the app.
- **External links**: artists with their own tracker site (e.g. Frank Ocean) open in the browser.

## Installation

1. Download `ArtistGrid.apk` from the [Releases](../../releases) page.
2. Open it on your phone and allow installation from unknown sources.

Requires Android 6.0 or later.

## How it works

It is a [Capacitor](https://capacitorjs.com) app: the interface is plain HTML/CSS/JavaScript in [`www/`](www), with no framework and no build step. Data comes from:

| Data | Endpoint |
| --- | --- |
| Artist list | `https://artists.artistgrid.cx/artists.csv` |
| Trackers | `https://trackerapi.artistgrid.cx/sh/<id>/` · `/sh/<id>/tab/<tab>` |
| Artist photos | `https://assets.artistgrid.cx/webp/<name>.webp` |
| Audio | pillows.su, pixeldrain and Google Drive links, resolved the same way as on the site |
| Fallback covers | `https://itunes.apple.com/search` · `https://api.deezer.com/search/{artist,album}` |

Requests go through Capacitor's native HTTP client (`CapacitorHttp`), so the app does not depend on CORS rules. Downloaded trackers are stored in IndexedDB for offline use.

Audio and covers that fail to load directly are requested through `/_proxy?u=<url>`, which [`ProxyWebViewClient`](android/app/src/main/java/cx/artistgrid/app/ProxyWebViewClient.java) serves natively (no referrer, Range requests forwarded). Because proxied audio is same-origin, the Web Audio equalizer can process it.

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

## Known limitations

- With the screen off, Android may pause playback (there is no background audio service yet).
- Only pillows.su, pixeldrain and Google Drive links play in the app; other links open externally.
- The published APK is a debug build, not signed for the Play Store.
- The app interface is currently in Italian.

## License

Code released under the [MIT](LICENSE) license. Data and images belong to ArtistGrid and the tracker curators.
