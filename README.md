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
- **Built-in player**: a mini-player above the tab bar that opens a full-screen player with cover, seek bar, shuffle, repeat, playback speed, queue and audio output picker (Bluetooth, headphones, speaker).
- **Background playback**: music keeps playing with the screen off, with controls in the notification, on the lock screen and on headsets.
- **Light and dark theme**: switch with the button next to the title, or follow the system in Settings.
- **Favorites**: save the artists you follow.
- **Offline use**: trackers you have already opened stay available without a connection, and a copy of the artist list ships with the app.
- **External links**: artists with their own tracker site (e.g. Frank Ocean) open in the browser.

## Installation

1. Download `ArtistGrid.apk` from the [Releases](../../releases) page.
2. Open it on your phone and allow installation from unknown sources.

Requires Android 6.0 or later.

New versions are announced in the app (Settings → Updates) and install over the previous one, keeping your favorites.

## For developers

How the app works, how to build it from source and how releases are published: see [docs/BUILDING.md](docs/BUILDING.md).

## Known limitations

- Only pillows.su, pixeldrain and Google Drive links play in the app; other links open externally.
- The published APK is a debug build, not signed for the Play Store.

## License

Code released under the [MIT](LICENSE) license. Data and images belong to ArtistGrid and the tracker curators.
