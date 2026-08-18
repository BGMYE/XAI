# MuMu 安卓模拟器调试指南

本文档记录 Image Studio 安卓端在 MuMu 模拟器中的常用调试流程，方便多人协作时使用同一套构建、安装、截图和排错方法。

## 环境约定

- 工作目录：`/Users/lin/Image-Studio`
- 安卓壳工程：`android-shell/`
- 前端工程：`image-studio/frontend/`
- MuMu ADB：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb
```

- 常用设备地址：`127.0.0.1:16384`
- Debug 包名：`top.gptcodex.imagestudio.android.debug`
- MuMu 窗口获得焦点时，`Ctrl + Cmd + R` 可切换横竖屏。

如果设备端口变化，先执行：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb devices
```

## 连接模拟器

推荐先连接并切回非 root adbd，减少权限状态差异：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb connect 127.0.0.1:16384
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb -s 127.0.0.1:16384 unroot
sleep 1
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb connect 127.0.0.1:16384
```

进入 shell：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb -s 127.0.0.1:16384 shell
```

## 构建前端

先构建安卓目标前端：

```bash
cd /Users/lin/Image-Studio/image-studio/frontend
npm run build:android
```

如果宿主 npm 缓存权限异常，可使用仓库内缓存：

```bash
cd /Users/lin/Image-Studio/image-studio/frontend
npm_config_cache=/Users/lin/Image-Studio/.tmp/android-npm-cache npm ci
npm run build:android
```

## 构建 APK

推荐用 Docker 构建，避免本机 Android SDK 差异。Apple Silicon 上使用 `linux/amd64`，否则可能遇到 AAPT2/Rosetta 问题。

```bash
cd /Users/lin/Image-Studio
docker run --rm --platform linux/amd64 \
  -e IMAGE_STUDIO_ANDROID_USE_PREBUILT_FRONTEND=1 \
  -v /Users/lin/Image-Studio:/workspace \
  -w /workspace/android-shell \
  ghcr.io/cirruslabs/android-sdk:35 \
  ./gradlew :app:assembleDebug
```

成功标志：

- 输出包含 `prepareFrontendDependencies SKIPPED`
- 输出包含 `BUILD SUCCESSFUL`
- APK 位于 `android-shell/app/build/outputs/apk/debug/app-debug.apk`

Gradle 日志中的 `Couldn't poll for events, error = 4` 通常是 Docker 文件监听告警；只要最终 `BUILD SUCCESSFUL`，可忽略。

## 安装和启动

安装 debug APK：

```bash
cd /Users/lin/Image-Studio
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb \
  -s 127.0.0.1:16384 \
  install -r android-shell/app/build/outputs/apk/debug/app-debug.apk
```

启动应用：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb \
  -s 127.0.0.1:16384 \
  shell monkey -p top.gptcodex.imagestudio.android.debug -c android.intent.category.LAUNCHER 1
```

## 截图取证

建议把截图统一保存到 `.tmp/mumu-live/`，该目录已被忽略，不应提交。

```bash
mkdir -p /Users/lin/Image-Studio/.tmp/mumu-live

/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb \
  -s 127.0.0.1:16384 \
  shell screencap -p /sdcard/current.png

/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb \
  -s 127.0.0.1:16384 \
  pull /sdcard/current.png /Users/lin/Image-Studio/.tmp/mumu-live/current.png
```

常用导航坐标以 `1440x2560` 竖屏为参考：

- 右上角设置：`input tap 1330 95`
- 底部参数：`input tap 240 2425`
- 底部画布：`input tap 720 2425`
- 底部历史：`input tap 1210 2425`

示例：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb \
  -s 127.0.0.1:16384 \
  shell input tap 1210 2425
```

如果 `input tap/swipe` 没有效果，通常是焦点不在应用或模拟器窗口状态异常。先重新启动应用，再点击页面内部一次后重试。

## 横竖屏验证

最稳定方式是在 MuMu 窗口获得焦点时按：

```text
Ctrl + Cmd + R
```

也可以先检查当前窗口尺寸：

```bash
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb -s 127.0.0.1:16384 shell wm size
/Applications/MuMuPlayer.app/Contents/MacOS/MuMuEmulator.app/Contents/MacOS/tools/adb -s 127.0.0.1:16384 shell wm density
```

## UI 调试建议

1. 每次 UI 改动后先跑 `npm run build:android`，再打 APK。
2. 安卓手机端和 Pad 端是不同 UI 目标，不要用同一套布局假设覆盖两端。
3. 改历史页、设置页、参数页时，至少截一张顶部状态和一张滚动后的底部状态。
4. 历史页不要承载上游配置入口；安卓手机端上游配置集中放在设置页。
5. 桌面端和安卓端共享组件时，优先使用 `isAndroidPhone` 分支或 `html[data-target-platform="android"]` CSS 限定，避免影响 macOS/Windows。

## 提交前检查

```bash
cd /Users/lin/Image-Studio
npm run build:android --prefix image-studio/frontend
git diff --check
git status --short
```

不要提交以下生成产物：

- `image-studio/frontend/dist/`
- `image-studio/frontend/node_modules/`
- `android-shell/.gradle/`
- `android-shell/build/`
- `android-shell/app/build/`
- `android-shell/app/src/main/assets/web/`
- `.tmp/`

