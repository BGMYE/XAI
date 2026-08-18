# Android Settings

This folder owns Android-only settings surfaces.

- `AndroidSettingsPanel.tsx` renders the touch-first settings content for both phone and Pad.
- Phone keeps the bottom-sheet modal shape; Pad uses the same settings content in a wider two-column touch layout.

Keep shared settings actions in `components/panel/SettingsPanel.tsx`. Visual layout and Android-specific grouping belong here and in `_android-settings.css`, scoped by `html[data-target-platform="android"]` or `html[data-target-platform="android-pad"]`.
