# Android History

This folder owns Android touch-first history UI for phone and Pad.

- `AndroidHistoryTile.tsx` is the touch-first result card. It handles long press locally and keeps desktop history tile behavior unchanged.
- `AndroidHistoryActionSheet.tsx` replaces the desktop floating context menu on Android with a sheet sized for touch.

Keep shared history behavior in `components/history/` when it affects every platform. Android-only visual layout, touch gestures, and action presentation should stay here and in `_android-history.css`, scoped by `html[data-target-platform="android"]` or `html[data-target-platform="android-pad"]`.
