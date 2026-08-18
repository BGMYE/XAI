# Android Canvas

This folder owns the Android-only canvas shell.

- `AndroidCanvasWorkspace.tsx` is the touch-first page chrome: header, source strip, tool dock, image actions, and progress surface.
- `AndroidCanvasStage.tsx` is the Android stage wrapper. It keeps the same store contract as the desktop canvas but adds touch-oriented behavior such as pinch zoom and Android haptics.

Keep desktop canvas components under `components/canvas/` untouched unless a shared rendering bug truly affects every platform. Android-specific layout and controls should stay in this folder and in `_android-canvas.css`, scoped by `data-platform="android"` / `data-target-platform`.
