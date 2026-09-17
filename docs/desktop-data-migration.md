# Desktop data migration evidence

Source audit: 2026-09-18. The comparison is the XAI v2 tree at
`06a15810f124fc7f388c66cae09410fe223614f2` against this Wails
`v3.0.0-beta.23` redesign. This is source evidence, not a claim that a native
upgrade has been exercised on all three operating systems.

## Identities retained

| Data | Existing identity | Redesign behavior |
| --- | --- | --- |
| Windows WebView origin | `http://wails.localhost/` | `desktopOriginURLForPlatform` uses the same origin for main and settings |
| macOS/Linux WebView origin | `wails://wails/` | Same scheme/host; settings adds only `?window=settings` |
| Credential service | `Image Studio` | `backend/credentials.go` is unchanged from v2 |
| Credential account | `api-key:profile:<id>`, legacy `api-key:images` / `api-key:responses` | Same normalization and system keyring library |
| Windows data root | Registry `HKCU\Software\YuanHua\Image Studio`, value `DataRoot`; initial default Documents/Image Studio | Same resolver, WebView subdirectory `webview` |
| macOS/Linux backend config | Go `os.UserConfigDir()/image-studio` | Same resolver |
| macOS/Linux images | `~/Pictures/Image Studio` | Same default and user-selected output handling |
| macOS bundle | `top.gptcodex.imagestudio` | Same current bundle identity; existing `com.wails.image-studio` migration remains |
| History IndexedDB | `image-studio`; older `keyval-store` import | Existing `lib/storage.ts` history reader and legacy import remain |
| New workspace IndexedDB | `image-studio-desktop-workspaces`, store `snapshots`, key `current` | New persistence for workspaces/canvas; v2 had no equivalent restart archive |

`desktop_origin_test.go` verifies both window URLs for all three platforms.
Backend compatibility storage remains a separate JSON fallback and now retains
model catalogs, video model and AI role fields. Those tests do not substitute
for opening a real WebView profile from the old application.

## Linux GTK3 to GTK4

Both Wails versions leave Linux `ProgramName` unset in this application, and
the release executable remains `image-studio`. Do not set a different
`Linux.ProgramName` or infer a new storage folder from the application display
name without an explicit migration.

Read upstream source:

1. [Wails v2.12.0 linux/window.c](https://github.com/wailsapp/wails/blob/v2.12.0/internal/frontend/desktop/linux/window.c),
   `SetupWebview`: `webkit_web_view_new_with_user_content_manager` uses the
   default context. [linux/frontend.go](https://github.com/wailsapp/wails/blob/v2.12.0/internal/frontend/desktop/linux/frontend.go)
   calls `gtk_init_check(nil, nil)` and changes `g_set_prgname` only if explicitly configured.
2. [Wails v3.0.0-beta.23 linux_cgo.go](https://github.com/wailsapp/wails/blob/v3.0.0-beta.23/v3/pkg/application/linux_cgo.go),
   `windowNewWebview`: `webkit_network_session_get_default()`;
   [linux_cgo.c](https://github.com/wailsapp/wails/blob/v3.0.0-beta.23/v3/pkg/application/linux_cgo.c),
   `create_webview_with_user_content_manager`: creates a view without a custom
   `network-session`. `application_linux_appid.go` leaves the program name
   untouched when neither Linux application ID nor program name is supplied.
3. [WebKitGTK 2.44.0 WebsiteDataStoreGLib.cpp](https://github.com/WebKit/WebKit/blob/webkitgtk-2.44.0/Source/WebKit/UIProcess/WebsiteData/glib/WebsiteDataStoreGLib.cpp):
   `defaultBaseDataDirectory()` is `userDataDirectory()/programName()`;
   `programName()` returns `g_get_prgname()` or the fallback `webkitgtk`.
   `defaultBaseCacheDirectory()` uses the matching user cache root.
   Thus the usual base is `$XDG_DATA_HOME/image-studio` (default
   `~/.local/share/image-studio`), not the GTK major-version directory.
4. [GLib 2.80.0 goption.c](https://github.com/GNOME/glib/blob/2.80.0/glib/goption.c):
   `g_option_context_parse()` obtains a missing program name through
   `platform_get_argv0()`, which reads `/proc/self/cmdline` and uses its basename
   on Linux. Passing nil command arguments alone does not prove that the data
   directory becomes `webkitgtk`.
5. [WebKitGTK 2.44.0 WebKitNetworkSession.cpp](https://github.com/WebKit/WebKit/blob/webkitgtk-2.44.0/Source/WebKit/UIProcess/API/glib/WebKitNetworkSession.cpp):
   `webkit_network_session_get_default()` uses null data/cache directories;
   the constructor resolves them through `WebsiteDataStore` defaults.
6. WebKitGTK 6.0 does change the storage layout: `WebsiteDataStoreGLib.cpp`
   selects `UnifiedOriginStorageLevel::Basic` for `ENABLE(2022_GLIB_API)`
   instead of `None`. [OriginStorageManager.cpp](https://github.com/WebKit/WebKit/blob/webkitgtk-2.44.0/Source/WebKit/NetworkProcess/storage/OriginStorageManager.cpp)
   contains the built-in upgrade: `resolvedLocalStoragePath()` moves the old
   SQLite database if the destination is absent; `resolvedIDBStoragePath()`
   calls `IDBStorageManager::migrateOriginData` for legacy databases.

No application-side recursive copy of a guessed GTK3 directory is justified
by these sources. WebKit owns its on-disk schema conversion. The retained
origin and program identity allow it to locate the old data. Native upgrade
testing must still confirm this on the supported Ubuntu/WebKit package set;
source inspection cannot prove permissions, distribution patches, or a user's
previous renamed executable.

## macOS and Windows

Both Wails macOS implementations construct `WKWebViewConfiguration` without
replacing its default persistent website data store:
[v2 WailsContext.m](https://github.com/wailsapp/wails/blob/v2.12.0/internal/frontend/desktop/darwin/WailsContext.m)
and [v3 webview_window_darwin.go](https://github.com/wailsapp/wails/blob/v3.0.0-beta.23/v3/pkg/application/webview_window_darwin.go).
XAI retains its existing `~/Library/WebKit/com.wails.image-studio` to
`~/Library/WebKit/top.gptcodex.imagestudio` migration. It refuses to overwrite a
populated current profile. The migration now returns without moving anything
when `IMAGE_STUDIO_DATA_ROOT` is set to an absolute path; its isolation test
uses only `t.TempDir()` fixtures.

Windows retains its explicit WebView2 profile directory and legacy migration
resolver before constructing the Wails application. The runtime upgrade does
not introduce a new WebView2 directory or keyring service name.

## Isolation and remaining native acceptance

`IMAGE_STUDIO_DATA_ROOT` isolates backend config, output and imports, and the
Windows WebView2 profile. It **does not** by itself redirect the native macOS
WKWebsiteDataStore, Linux XDG WebKit data or the operating system keyring.
Native macOS/Linux upgrade exercises require a disposable OS account or VM;
do not point native tests at a real user's WebView profile. Credential tests
use injected fake stores and synthetic values.

For each supported OS, acceptance still requires launching the old build in
that disposable account, saving synthetic configuration/history/media, then
launching the redesign with the same identity and confirming the values and
media remain available across another restart. Also verify the expected
system credential entry without writing its value to a log. Preserve the old
profile backup during this exercise. A passing origin unit test or a browser
mock is not evidence of this native upgrade.
