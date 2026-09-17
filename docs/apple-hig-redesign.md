# Desktop redesign acceptance record

Status: implementation in progress. No acceptance item below is claimed complete without recorded evidence.

Design reference: dickwu/apple-design-skill at `da2da6dd03aacf06da3fecf205347601d38bb141`.
Scope: Windows, macOS and Linux Wails desktop. Android and Gio retain their existing UI.

## Accepted product decisions

- Keep simple and professional modes, a shared shell and visible workspace controls.
- Liquid Glass belongs to the functional layer; content, image pixels and long forms stay neutral and readable (`liquid-glass.md`, The two layers).
- Default to light appearance, including the first frame, as requested in the latest product direction. Retain dark palette regression coverage. Support 200% text, system contrast, reduced motion and transparency (`accessibility.md`, Vision; `dark-mode.md`, Best practices).
- Restore the supplied pale blue and white satin background reference (September 18 revision): static vector ribbons and soft light behind the app, with glass navigation. Forms and image pixels remain on stable surfaces. Reduced transparency/high contrast remove the wallpaper.
- Keep left traffic lights, using native macOS controls and custom Windows/Linux controls. The latter is the explicit exception to `windows.md`, Best practices.
- A real, singleton, non-modal settings window; stable categories and last-pane restoration (`settings.md`, Desktop).
- Wails `v3.0.0-beta.23`, public platform APIs only. Preserve backend business capabilities and credential identities.
- Main owns workspace/jobs/history; host owns shared settings; settings window owns drafts only. Never broadcast or persist API keys outside the system credential store.

## Acceptance matrix

| Area | Required evidence | Status |
| --- | --- | --- |
| Host migration | Three desktop builds, working main/settings windows, correct close/menu/dialog owners | Windows production build and host lifecycle tests passed; native multiwindow and other OS builds pending |
| Settings persistence | Concurrent writes preserve history; revision conflicts; modelIDs/videoModelID/aiProfileId round trips | Backend transaction/rollback/owner-merge tests and shared compatibility round trips passed |
| Credentials | Public snapshots/events/storage/logs omit synthetic secrets; keyring keep/replace/clear tests | Synthetic credential tests cover snapshots, files, probe, Images/Responses/SSE/WebSocket errors and raw logs; real OS keyring upgrade pending |
| Upgrade | Existing profiles, history, workspaces, IndexedDB and keyring survive v2 to v3 origin transition | Origins preserved and migration/round-trip tests passed; actual native upgrades pending |
| Simple creation | Models, ratios, counts, sources, parameters, submit/cancel/error and video verified | Headless real-store tests passed for images controls/import/remove/submit/cancel; full native/video flow pending |
| Professional canvas | Layers, masks, annotations, transforms, undo/redo, zoom, compare, batch/video, export verified | Unit actions and headless mask/annotation/undo/redo/zoom tests passed; full native export/batch/video pending |
| Library/details | Search/filter/group/page, reuse, regenerate, delete, save, CPU upscale and diagnostics verified | Search/filter/detail/diagnostics/prompt reuse and deletion confirmation passed; remaining native file operations pending |
| Settings and auxiliary UI | Seven categories; full upstream management; draft probe; all dialogs migrated | Seven headless settings tests passed, including conflict retention, model merge/custom entries, single-click navigation and close choices; native window verification pending |
| Accessibility | Keyboard, labels, focus restoration, 200% text, high contrast and system preferences verified | Headless focus/menu/dialog/navigation/200% and host preference fallback tests passed; native screen reader check pending |
| Visual | Light/dark at 960x640, 1440x980, large window; composite contrast measured; screenshots recorded | 30 screenshots across 960x640 / 1440x980 / 1920x1080 plus settings/dialogs and composite contrast passed |
| Regression/build | TypeScript, frontend, Go, compatibility, mock upstream, desktop/Android regression and GitHub checks | Local TypeScript, 264 frontend tests, 30 desktop browser tests and Go host/backend/client/compatibility passed; CI pending |
| Delivery | Source, Windows EXE, platform artifacts, screenshots and evidence links | Windows EXE built; final source revision/platform artifacts pending |

## Ownership during implementation

- Root: Wails host/runtime, entrypoints, native menus/preferences, build/release integration and final verification.
- Desktop agent: design tokens/primitives, shared shell/simple workspace, library/details and common modal accessibility.
- Canvas agent: professional panels and canvas controls.
- Settings agent: isolated settings frontend, revisioned backend configuration and compatibility schema.

## Validation constraints

Use isolated temporary directories for filesystem and cleanup tests, including Windows KnownFolder paths. Mock upstreams must use synthetic credentials. Do not send real keys into snapshots, screenshots, fixtures, build output or CI.

## HIG references and observed implementation

The following passages were read from the fixed skill revision, not inferred from the skill name:

| Reference | Passage | Implementation / evidence |
| --- | --- | --- |
| `liquid-glass.md › The two layers` | “Content layer. Text, images, lists, media, and app backgrounds.” / “Functional layer. Tab bars, toolbars, sidebars…” | Wallpaper is content; title/sidebar/tools use 24px backdrop blur; forms, detail reading areas and images use stable surfaces. |
| `liquid-glass.md › Review checklist` | “Reduce Transparency gets an opaque fallback… Reduce Motion drops morphing and refraction animation.” | Native preference bridge and CSS fallbacks; headless assertions show `backdrop-filter: none`, white functional surface and zero transition duration. |
| `typography.md › Ensuring legibility` | “Use font sizes that most people can read easily.” | 14px base/12px secondary and system UI fonts, with 200% persistence and layout checks. |
| `typography.md › Conveying hierarchy` | “Minimize the number of typefaces you use…” | Shared system font token applies to desktop settings, main and portals; no Apple font files bundled. |
| `settings.md › Best practices` | “Make settings available in ways people expect.” | Cmd/Ctrl+, and native menu open the singleton settings window. |
| `settings.md › Desktop (macOS)` | “Dim a settings window’s minimize and maximize buttons.” / “Restore the most recently viewed pane.” | Host disables those window buttons; last-pane preference persists; window title tracks the selected pane. |
| `windows.md › Best practices` | “Make sure that your windows adapt fluidly to different sizes…” | 960px, 1440px, 200% layout tests and recoverable inspector controls. Native cross-platform sizing still requires verification. |
| `accessibility.md › Speech` | “Let people use the keyboard alone to navigate and interact with your app.” | Menu arrow keys, Tab traps, Escape, focus restoration, labelled inputs and canvas tools are exercised in browser behavior tests. |

The pale blue default background and custom Windows/Linux left traffic lights are explicit user preferences. The WebView material approximates glass; it is not Apple's native Liquid Glass and uses no private Apple APIs.

## Recorded browser contrast

The browser test hides foreground glyphs, screenshots the composited backdrop, samples nine pixels in each target, and compares actual computed text colors. This covers the current wallpaper, blur and glass fill at the sampled locations, not every possible image background.

| Sample | Light minimum | Dark minimum |
| --- | --- | --- |
| Title | 15.94:1 | 13.56:1 |
| Sidebar secondary text | 5.60:1 | 6.18:1 |
| Content secondary text | 5.10:1 | 8.35:1 |
| Menu | 15.11:1 | 12.24:1 |

Representative screenshots and measurements are committed in [desktop-evidence](desktop-evidence): [simple](desktop-evidence/simple-light.png), [canvas](desktop-evidence/canvas-light.png), [library detail](desktop-evidence/library-detail-light.png), [settings](desktop-evidence/settings-light.png), [dark canvas](desktop-evidence/canvas-dark.png). Full captures are written to `.tmp/hig-evidence` during Playwright runs.

The complete headless desktop suite passed 30 tests on Edge, including real IndexedDB reload and failure/retry tests, settings isolation, generation parameter snapshots, close-time edits, accessible menus/dialogs, layouts and contrast. The Wails calls are mocked; these tests do not prove native operating-system window or keyring behavior.

Origin, filesystem and WebKit upgrade findings are recorded in [desktop-data-migration.md](desktop-data-migration.md). Native migration verification requires a disposable OS account or VM on macOS/Linux because backend directory overrides do not redirect the system WebView store or credential service.
