# Android Upstream Config

This folder owns the Android-only upstream configuration UI.

## Boundary

- `AndroidUpstreamConfigModal.tsx` is the Android entry rendered by `UpstreamConfigGate`.
- `useAndroidUpstreamConfig.ts` owns profile selection, draft state, key loading, save, activation, and test actions.
- `AndroidUpstreamProfileRail.tsx` owns the profile list and destructive profile actions.
- `AndroidUpstreamProfileForm.tsx` owns editable fields and save/test controls.
- `AndroidUpstreamEmptyState.tsx` owns first-run creation.

Desktop and shared panel code should not import from this folder. If a future change must affect macOS, Windows, or Linux upstream configuration, make that change in `components/panel/UpstreamConfigModal.tsx` instead.

## Styling

Styles live in `src/styles/_android-upstream.css` and are scoped under `html[data-platform="android"]`.
