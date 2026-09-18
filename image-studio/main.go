package main

import (
 "context"
 "embed"
 "net/http"
 "runtime"
 "image-studio/backend"
 "github.com/wailsapp/wails/v2"
 "github.com/wailsapp/wails/v2/pkg/options"
 "github.com/wailsapp/wails/v2/pkg/options/assetserver"
 wailsmac "github.com/wailsapp/wails/v2/pkg/options/mac"
 wailswindows "github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main(){
 svc:=backend.NewService();studio:=backend.NewStudioV2(svc)
 media:=func(next http.Handler)http.Handler{return studio.MediaHandler(svc.MediaHandler(next))}
 appOptions:=&options.App{
  Title:"XAI · Image Studio",Width:1440,Height:980,MinWidth:1100,MinHeight:780,
  AssetServer:&assetserver.Options{Assets:assets,Handler:media(http.NotFoundHandler()),Middleware:media},
  BackgroundColour:&options.RGBA{R:230,G:241,B:255,A:1},
  OnStartup:func(ctx context.Context){svc.Startup(ctx);studio.Startup(ctx)},
  OnShutdown:func(ctx context.Context){studio.Shutdown(ctx);svc.Shutdown(ctx)},
  SingleInstanceLock:&options.SingleInstanceLock{UniqueId:"top.gptcodex.imagestudio",OnSecondInstanceLaunch:func(data options.SecondInstanceData){svc.HandlePromptImportArgs(data.Args)}},
  Bind:[]interface{}{svc,studio},
 }
 if runtime.GOOS=="darwin"{
  if err:=backend.MigrateMacWebkitDataDir();err!=nil{println("Warning:",err.Error())}
  appOptions.Mac=&wailsmac.Options{Appearance:wailsmac.DefaultAppearance,TitleBar:wailsmac.TitleBarHiddenInset(),WebviewIsTransparent:false,WindowIsTranslucent:false,OnUrlOpen:svc.HandlePromptImportURL}
 }
 if runtime.GOOS=="windows"{
  appOptions.Frameless=true
  userData,err:=backend.WindowsWebviewUserDataPath();if err!=nil{println("Error:",err.Error());return}
  legacy,err:=backend.WindowsLegacyWebviewUserDataPaths();if err!=nil{println("Error:",err.Error());return}
  if err=backend.MigrateWindowsWebviewDataDirs(userData,legacy);err!=nil{println("Warning:",err.Error())}
  fixed,err:=backend.WindowsPortableWebviewBrowserPath();if err!=nil{println("Warning:",err.Error())}
  if fixed!=""{if err=backend.EnsureWindowsFixedWebviewRuntimePermissions(fixed);err!=nil{println("Warning:",err.Error())}}
  appOptions.Windows=&wailswindows.Options{Theme:wailswindows.SystemDefault,BackdropType:wailswindows.Mica,WebviewIsTransparent:false,WindowIsTranslucent:true,WebviewBrowserPath:fixed,WebviewUserDataPath:userData,CustomTheme:&wailswindows.ThemeSettings{
   DarkModeTitleBar:wailswindows.RGB(32,32,32),DarkModeTitleBarInactive:wailswindows.RGB(38,38,38),DarkModeTitleText:wailswindows.RGB(245,245,245),DarkModeTitleTextInactive:wailswindows.RGB(200,200,200),DarkModeBorder:wailswindows.RGB(54,54,54),DarkModeBorderInactive:wailswindows.RGB(45,45,45),
   LightModeTitleBar:wailswindows.RGB(230,241,255),LightModeTitleBarInactive:wailswindows.RGB(237,237,237),LightModeTitleText:wailswindows.RGB(31,31,31),LightModeTitleTextInactive:wailswindows.RGB(96,96,96),LightModeBorder:wailswindows.RGB(219,219,219),LightModeBorderInactive:wailswindows.RGB(226,226,226),
  }}
 }
 if err:=wails.Run(appOptions);err!=nil{println("Error:",err.Error())}
}
