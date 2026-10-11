# DLSS5Tool source attribution

This directory contains the dependency closure of `dlss_host_process.py`,
`video_export.py`, and `vfr_mux.py`, plus localization resources, copied from:

- https://github.com/banbanzhige/DLSS5Tool
- Commit: e23654c6b6743ebf7487256c10f93455c8ba4bfd (2026-09-29)
- License: LICENSE-DLSS5Tool.txt (MIT; retain copyright notice)
- Other components: THIRD_PARTY_NOTICES.md

XAI changes `dlss5tool/paths.py` so each spawned worker uses the explicitly
publisher-managed private native runtime directory and a job-specific state directory.
Other vendored Python modules are unmodified. No NVIDIA DLL, SDK, model weights,
FFmpeg executable, or other third-party binaries are included in this source directory. Distribution bundles obtain native assets
only from a publisher-curated authorized runtime source; MIT does not grant
rights to redistribute those third-party assets.

The dependency closure includes modules imported lazily by upstream code; XAI
exposes NR only, not the upstream experimental SR/FG/GPU-export features.
