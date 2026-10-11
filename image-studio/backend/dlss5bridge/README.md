# Local DLSS NR bridge

`bridge.go` embeds the Python entry point and pinned MIT source dependency closure.
Production uses a frozen `worker/xai-video-engine.exe` beside the app in
`runtimes/dlss5`, selected by its complete integrity manifest. The retained
`Materialize`/`Extract` functions support source/developer tests, not user setup.
XAI's bridge/packaging code follows the repository's AGPL-3.0 license; the
vendored DLSS5Tool code retains MIT. Frozen bundles preserve both licenses,
the build interpreter's original Python license and dependency notices.

This is a real, Windows x64, NVIDIA-dependent NR pipeline. It never downloads
models, sends API requests, opens the DLSS5Tool GUI, or bundles NVIDIA runtimes.
The publisher assembles the private native runtime with
`image-studio/scripts/dlss5/build.ps1`. End users do not install Python or
DLSS5Tool and do not configure paths. GPU compatibility and speed must be
verified on a clean Windows RTX machine without those developer tools.

## Protocol

The app launches the manifest-selected frozen EXE directly. For developer
tests, `python -u bridge.py` uses the same protocol. Paths below are internal
resolved bundle paths supplied by the app, not user-facing configuration.
Supply one UTF-8 JSON object followed by a newline:

```json
{"version":1,"id":"preview-1","op":"preview","toolRoot":"C:\\XAI\\runtimes\\dlss5\\runtime","runtimePath":"","inputPath":"C:\\videos\\input.mp4","outputPath":"C:\\results\\processed.mp4","sourceOutputPath":"C:\\results\\reference.mp4","positionSeconds":0,"durationSeconds":3,"resolution":{"mode":"custom","width":1280,"height":720},"options":{"enabled":true,"style":0,"intensity":1,"localTone":1,"localStructure":1,"skinStructure":1,"autoMask":true,"outputMix":1,"flowBackend":"off","flowWidth":512,"flowIterations":6}}
```

- `op`: `probe`, `preview`, or `export`. Probe needs only installation fields.
- `runtimePath`: optional explicit DLL. With no explicit selection, use
  `toolRoot/mods/nvngx_dlssnr.dll` first, otherwise require exactly one default
  DLL in `_internal`, `runtime`, or the installation root. A missing explicit
  selection is an error; no silent replacement.
- `resolution`: `source` or `custom`. Both paths validate actual dimensions.
  Custom dimensions preserve aspect ratio and add black padding **before NR**.
- Preview: at most 10 seconds, side 128–4096, even dimensions, <=3840×2160 pixels.
  Export: whole video, side 128–8192, even dimensions, <=7680×4320 pixels.
- The five strengths are finite `0–1` values. `style` is 0/1/2; `flowBackend`
  is off/raft/nvofa; flow analysis width 128–2048 and RAFT iterations 1–32.
  `autoMask` is the upstream skin-structure switch, not a user-painted mask.
- Output paths must not already exist. Output is H.264/yuv420p/faststart MP4.
- Output events: `{type:"progress",id,progress:0..100,stage,message}`;
  `{type:"result",id,...}`; or `{type:"error",id,error,code}`.
  A completed unavailable probe returns a result with `available:false` and
  `reason` with exit 0. Processing failures return error with nonzero exit.
- `--self-test` is a build-only frozen dependency smoke (no NVIDIA execution).
- Probe executes a real 128×128 NR frame. Every advertised optical-flow backend
  also passes its two-frame preflight. This does not guarantee enough VRAM or
  throughput at every output size.
- Send another line `{version:1,id:"preview-1",op:"cancel"}` for cancellation.
  EOF after the request is permitted. The parent should terminate the complete
  Windows process tree if cooperative cancellation exceeds its grace period.

## Media contract and limits

Frames stream from FFmpeg at the requested output dimensions into
`ProcessLive.process`; NR output is blended and encoded at those same dimensions.
Original/processed preview files use the same decoded frames and time range.
Reference frames are scaled/padded originals, never replaced by NR output.
No full-video frame cache is held; a bounded timestamp index is retained.

Audio is preserved by the upstream copy-or-AAC mux policy. Preview audio is first
trimmed to the actual selected frame interval. VFR PTS and the final frame's
extent are restored with PyAV after encoding, with no second video encode.
Outputs are inspected for dimensions, codec, pixel format and frame count before
publication. This does not preserve subtitles, chapters or arbitrary metadata.

This version explicitly rejects HDR/PQ/HLG/Dolby Vision, nonzero video timeline
starts, duplicate or reversed PTS, missing timestamps and unsupported sizes.
It does not provide super-resolution, frame generation, semantic masks, or a
30/60-fps real-time guarantee. Preview creates a short processed clip and resets
NR history at its first selected frame; it is not a live GPU texture stream.
Exact frame selection currently scans source timestamps and decodes earlier
frames, so seeking late in a long video may take time.

## Verification

`python -m unittest discover -s tests -v` tests protocol, option/range handling,
resolution planning, VFR selection, bounded frame reads, child cancellation and
mocked NR boundaries without requiring a GPU. Go tests check resource extraction
and tamper detection. Windows native inference and driver compatibility require
an RTX machine; passing CPU tests is not evidence of GPU execution.

Source attribution and modifications: `vendor/UPSTREAM.md` and
`vendor/LICENSE-DLSS5Tool.txt`.

The release package must pass clean-Windows installation and RTX checks. The
current source tests and cross-compiles do not certify a distributable native
engine; authorized runtime assets and a Windows build remain required.
