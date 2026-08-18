# Android Parameters

This folder owns the Android-only parameter page controls for the compose view.

## Boundary

- `AndroidPhoneParameterSection.tsx` owns the compact summary card and opens the parameter modal.
- `AndroidPadParameterSection.tsx` owns the tablet summary card and opens the same parameter modal.
- `AndroidParameterEditor.tsx` contains the shared modal content.
- `AndroidParameterPrimitives.tsx` contains shared touch controls used by both phone and Pad.
- `parameterOptions.ts` keeps option lists that are Android-specific presentation data.

Do not import these files from desktop components. Desktop parameter controls remain under `components/panel/`.

## Maintenance Notes

- Touch targets should stay at least 44px high.
- Keep the compose page as a summary card; full editing belongs in the modal, matching Android settings.
- Phone and Pad may differ in entry-card density, but must share modal option semantics.
- Resolution availability must go through `sizeCapabilities.ts`; do not hard-code large-size support in a single Android target.
