# Cross-Platform Kernel Plan

## Why

Current frontend behavior still assumes the desktop Wails backend is the primary kernel. Android works by shiming `window.go.backend.Service`, which is enough for file IO and shell helpers, but it breaks down for `Generate`, `Edit`, and `OptimizePrompt`. That is why the Android shell currently trips the "does not include the desktop Go backend" path.

## Target Split

1. `runtimeHost`
   Maps host-only capabilities such as dialogs, filesystem, secure key storage, local image transforms, external URL open, and runtime events.

2. `remote kernel`
   Owns upstream HTTP/SSE/image transport logic and should be shared by:
   - CF Worker
   - Android WebView shell
   - macOS / Windows / Linux frontend
   - browser preview / future web host

3. `desktop native extras`
   Keeps the Go/Wails-only value-add isolated:
   - system keychain access
   - native file dialogs
   - local image transforms on disk
   - opening files / folders in the OS shell

## What Landed In This Step

- Upstream source-image thumbnail fix was merged into the current tree.
- Frontend calls no longer import Wails bindings directly from scattered UI files.
- `frontend/src/lib/runtimeHost.ts` now centralizes host detection, capability reporting, runtime event wrappers, backend dispatch, and remote-job fallback.
- `frontend/src/lib/remoteKernel.ts` now owns shared Responses API / Images API request execution, retry rules, SSE parsing, prompt optimization, and upstream probing.
- `frontend/src/lib/virtualHostStore.ts` gives browser / Android shell a virtual file layer for source images, generated images, transforms, and raw-response viewing when no desktop filesystem backend is available.
- Desktop settings now expose a kernel runtime mode switch so Wails can be forced onto the same shared remote kernel path used by Android/browser for verification.
- A repository-local `cloudflare-worker/` package now exists and can proxy OpenAI-shaped `/v1/responses`, `/v1/images/*`, `/v1/models`, and prompt-optimize requests while reusing the shared request model / retry semantics.
- The Worker package now has executable Node tests covering retrying `/v1/responses`, raw JSON proxying for `/v1/images/generations`, multipart pass-through for `/v1/images/edits`, and prompt-optimize forwarding.
- The frontend shared remote kernel itself now has executable Node tests covering retrying Responses SSE, Images API JSON parsing, prompt optimization extraction, and upstream probe failures.
- Android shell shim no longer needs to fake a full desktop `window.go.backend.Service`; the frontend main path is now routed through `runtimeHost` while Android contributes runtime/event bootstrap plus explicit native host methods only.
- `runtimeHost` now also has executable tests for remote job lifecycle events and cancellation, so the desktop remote-mode facade itself is covered instead of only the lower-level request kernel.
- A repo-local `scripts/live-verify.mjs` now exists for the remaining real-upstream proof step: it can compare direct upstream vs Worker-proxied `/v1/models`, prompt-optimize, and minimal `/v1/responses` calls once `IMAGE_STUDIO_UPSTREAM_BASE_URL` and `IMAGE_STUDIO_API_KEY` are provided.
- A repo-local `scripts/local-smoke-check.mjs` now gives one-command verification of the local smoke harness path: frontend remote mode assumptions, Worker proxying, and mock-upstream `/v1/models`, `/v1/responses`, `/v1/images/*`, and prompt-optimize all flow end-to-end over real HTTP.
- A dedicated GitHub Actions workflow now exists at `.github/workflows/verify-platform-kernel.yml`, wired to the repo-local verification suite in `scripts/verify-local-platform-kernel.mjs`, so the locally provable part of the multi-platform kernel path is CI-repeatable.
- A separate manual workflow now exists at `.github/workflows/live-verify-platform-kernel.yml`, so once real upstream secrets are available the remaining direct-vs-worker parity proof can run in CI without extra scripting.

## Next Refactor Stages

1. Run live end-to-end verification where desktop remote mode, Android shell, and Worker all hit the same upstream flow.
2. Rework Android shell to provide only host capabilities, not a fake desktop backend surface.
3. Split capability checks more explicitly between native host features and virtual-host fallbacks in the settings / toolbar UX.
4. Tighten Worker-side request normalization so prompt-optimize and future edit flows can share more code with the frontend remote kernel.

## Design Constraint

Platform theme split stays separate from core logic. The runtime host should decide capability boundaries, not UI theme code.
