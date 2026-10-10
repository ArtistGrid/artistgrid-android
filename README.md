# ArtistGrid for Android

An **unofficial** Android app for [ArtistGrid](https://artistgrid.cx), the collection of unreleased music trackers.
Browse artists, explore trackers era by era and listen to tracks right from your phone, with an interface built for mobile.

> This project is not affiliated with ArtistGrid. All data comes from the site's public APIs, and the trackers belong to their respective authors, who are credited in the app.

## Features

- **Artist grid**: 580+ artists with photos, instant search and filters (All, ♥ Favorites, ★ Recommended, Updated).
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

Requests go through Capacitor's native HTTP client (`CapacitorHttp`), so the app does not depend on CORS rules. Downloaded trackers are stored in IndexedDB for offline use.

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
