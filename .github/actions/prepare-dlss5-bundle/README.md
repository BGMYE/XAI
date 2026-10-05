# Required Windows x64 release input

Release and fixed-WebView portable builds require these repository Actions variables:

| Variable | Value |
| --- | --- |
| `XAI_DLSS5_BUNDLE_RUN_ID` | Successful trusted `push` or `workflow_dispatch` run in this repository |
| `XAI_DLSS5_BUNDLE_ARTIFACT` | Exact name of the retained Actions artifact from that run |
| `XAI_DLSS5_BUNDLE_SHA256` | SHA-256 of the artifact's sole file, `dlss5-bundle.zip` |

The producer is [build-dlss5-engine.yml](../../workflows/build-dlss5-engine.yml): manually dispatch it from the default branch on a trusted Windows x64 RTX runner labelled `xai-dlss5-builder`, with the protected `dlss5-publisher` environment. The runner must define `XAI_DLSS5_RUNTIME_SOURCE` for curated authorized native assets; optional `XAI_DLSS5_BUILD_PYTHON` selects its build interpreter. It builds the frozen worker and ZIP, requires a real NR probe with `result.available: true`, then uploads only `dlss5-bundle.zip`. Copy its summary's run ID, artifact name and SHA256 into these repository variables together. The private stderr log is not uploaded, and a successful GPU-free dependency smoke alone never passes the producer gate.

For local builds, see [the publisher instructions](../../../image-studio/scripts/dlss5/README.md); `scripts/build-windows-engine-zip.ps1` combines an existing x64 application and verified bundle into the ordinary complete ZIP. That ZIP relies on system WebView2.

The engine ZIP must contain the complete `dlss5/` directory, including its manifest and nested worker/runtime files. The consumer uses only the current repository's Actions API, rejects fork/PR runs and expired artifacts, compares the pinned ZIP hash before extraction, and verifies every staged runtime file. Hash checks establish integrity against the selected input; they are not a publisher signature or a license grant.

No default runtime asset is provided by this change. Until maintainers configure all three variables and provide a valid authorized bundle, Windows x64 release builds intentionally fail. The workflow does not fetch NVIDIA DLLs or accept arbitrary download URLs. Artifact retention matters: replace expired artifacts and update the run/name/hash together.

Windows x64 desktop downloads are complete ZIP packages with `image-studio.exe` and `runtimes/dlss5/`. NSIS and MSIX include the same recursive tree; the app EXE is signed before packaging when signing credentials exist. ARM64, macOS and Linux remain base editions and do not include this x64-only engine. Unsigned compile-check artifacts from PR CI are development outputs, not enhanced distribution packages.
