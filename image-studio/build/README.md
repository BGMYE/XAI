# Desktop build resources

The desktop host uses Wails `v3.0.0-beta.23`. Build commands and platform dependencies are documented in [docs/build.md](../../docs/build.md).

- `bin/` contains generated executables and app bundles and is ignored by Git.
- `appicon.png` is the macOS icon source. `scripts/package-local-macos-app.sh` uses the system `sips` and `iconutil` tools to produce a universal macOS 12+ app with bundle ID `top.gptcodex.imagestudio`.
- `darwin/Info.plist` and `Info.dev.plist` record the macOS metadata templates. The packaging script renders equivalent metadata using the version source in `wails.json`.
- `windows/icon.ico`, `info.json`, and `wails.exe.manifest` supply the executable icon, version information, and per-monitor DPI manifest. `scripts/build-desktop.mjs` renders the metadata in a temporary directory, invokes the pinned `wails3 generate syso` command, builds with Go, and removes its generated resource object.
- `windows/installer/` remains the standalone NSIS installer source used by the release workflow. It accepts explicit product and architecture definitions; it does not invoke Wails 2.
- `windows/msix/` contains the existing Microsoft Store package template.

Application identity, installation paths, WebView data paths, and credential storage are retained across the host migration.
