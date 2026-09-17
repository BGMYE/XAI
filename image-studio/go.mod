module image-studio

go 1.25.5

toolchain go1.26.3

require (
	github.com/gen2brain/avif v0.4.4
	github.com/wailsapp/wails/v3 v3.0.0-beta.23
	github.com/yuanhua/image-gptcodex v0.0.0-00010101000000-000000000000
	github.com/zalando/go-keyring v0.2.6
	golang.org/x/image v0.41.0
	golang.org/x/sys v0.46.0
	image-studio/shared/compat v0.0.0
)

replace github.com/yuanhua/image-gptcodex => ../go-cli

replace image-studio/shared/compat => ../shared/compat-go

require (
	al.essio.dev/pkg/shellescape v1.6.0 // indirect
	github.com/adrg/xdg v0.5.3 // indirect
	github.com/coder/websocket v1.8.14 // indirect
	github.com/danieljoos/wincred v1.2.3 // indirect
	github.com/ebitengine/purego v0.8.3 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.2.2 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/mattn/go-colorable v0.1.14 // indirect
	github.com/mattn/go-isatty v0.0.20 // indirect
	github.com/tetratelabs/wazero v1.9.0 // indirect
)

// replace github.com/wailsapp/wails/v3 v3.0.0-beta.23 => C:\Users\YuanHua\go\pkg\mod
