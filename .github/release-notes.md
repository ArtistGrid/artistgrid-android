A small fix-up release.

### Fixed
- **Empty tabs**: some tracker tabs (like **Recent** on several artists) showed nothing even though the website lists their tracks. Those tabs store their tracks differently (a flat list where each track names its era, or other field names); the app now reads all of these layouts and groups the tracks by era.
- Tracks with links written as plain text, or with notes split into several lines, are now read correctly.
- If a tab really has nothing the app can read, it now offers a button to open that tab in the Google Sheet.

### Installation
Download **ArtistGrid.apk** below, or update from **Settings → Updates** in the app. It installs over v1.2.0 / v1.3.0 and keeps your favorites. Requires Android 6.0+.

> Debug build, not signed for the Play Store. Playback may stop when the screen is off.
