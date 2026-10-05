# 发布者：构建 XAI 内置视频引擎

这些脚本只供维护者构建发行包。**终端用户安装完整 Windows x64 版 XAI 后，不需要安装 Python、不需要另装 DLSS5Tool，也没有处理器路径配置。** 应用仅从自身目录的 `runtimes/dlss5/manifest.json` 发现并校验内置引擎。

当前已实现免配置发现、冻结 worker、完整性校验和发行接线。仓库不含 NVIDIA 二进制、模型或完整运行库包；没有合法可分发的 native 资产和 Windows 构建/RTX 实测时，不能声称已交付可工作的内置引擎发行包。

## 构建输入

维护者需要 Windows x64、64 位 Python 3.10+、可用的依赖 wheels，以及自行取得并整理的可信 `RuntimeSource`。本流程不会下载 NVIDIA runtime，也不会修补它。输入目录必须已具备相应分发权限及第三方材料。

目录结构（实际文件，不接受符号链接或 junction）：

```text
RuntimeSource/
  dlssnr_host_v2.dll
  nvngx_dlssnr.dll
  ffmpeg.exe
  ffprobe.exe
  THIRD_PARTY_NOTICES.md
  licenses/                    # 所用 NVIDIA/FFmpeg 等原始许可、来源和构建说明
  ...                          # 原生依赖需要的其他 DLL
  mods/enhancement/            # 可选：完整已构建光流组件
    guidance_worker.exe
    enhancement.json
    _internal/...
    models/raft_large_C_T_SKHT_V2-ff5fadd5.pth
```

只启用 NR 时不需要 Torch 或光流组件。若包含 `mods/enhancement`，校验会要求完整组件协议、独立 Python 运行时，以及所声明 RAFT 后端的非空权重；不会将半个 addon 静默打进包。模型许可、NVIDIA runtime/SDK、FFmpeg 和 PyAV 自带媒体库均须按实际来源处理，MIT 只覆盖复用的自有源码。FFmpeg 含 libx264 等 GPL 配置时，还应随发行提供相应许可和对应源码获取材料。SHA256 是完整性校验，不是数字签名、来源认证或授权证明。

不要直接传整个开发工作区或含用户设置/缓存的安装目录。输入应为发布者整理过的运行库树；脚本会拒绝已知的开发环境清单，不将开发机路径写入产品 manifest。

## 构建冻结 worker 和 bundle

在源码根目录用 PowerShell 执行：

```powershell
.\image-studio\scripts\dlss5\prepare.ps1 `
  -ToolRoot 'D:\PublisherAssets\XAI-NR-runtime' `
  -EnvironmentRoot 'D:\BuildEnvironments\XAI-NR'

.\image-studio\scripts\dlss5\build.ps1 `
  -EnvironmentRoot 'D:\BuildEnvironments\XAI-NR' `
  -RuntimeSource 'D:\PublisherAssets\XAI-NR-runtime' `
  -OutputDirectory 'D:\BuildOutput\XAI-NR-1.0.0' `
  -BundleVersion '1.0.0'
```

`prepare.ps1` 在专用 venv 安装开发依赖，不修改全局 Python。`environment.json` 仅是开发清单，永远不进入产品包。需要时可用 `-Python` 指定开发解释器；`RuntimePath` 是开发调试输入，终端用户不使用这些选项。

`build.ps1` 使用 `engine.spec` 创建 console onedir worker，内含 Python、NumPy、OpenCV、PyAV 及依赖；应用以无窗口子进程方式运行它，保留 JSONL 标准流。包中保留 XAI 根目录 AGPL-3.0 许可、DLSS5Tool MIT 许可、构建解释器原始 Python/PSF 许可，以及依赖 wheel 的许可元数据；整个 XAI worker 不能标作仅 MIT。冻结依赖自检只验证 Python/CV2/AV/语言资源，不初始化 NVIDIA，也不能替代 RTX 实测。来自构建机的 NVIDIA 驱动 DLL 不由 PyInstaller 自动收集。

产物：

```text
BuildOutput/
  bundle/dlss5/
    manifest.json
    worker/xai-video-engine.exe
    worker/_internal/...
    runtime/...                # 可信输入完整树
    licenses/...
  dlss5-bundle.zip              # ZIP 顶层是 dlss5/
  build-report.json             # 仅开发者报告，不进入 ZIP
```

输出目录可新建或已存在且为空，非空目录会拒绝。`build-report.json` 的绝对构建路径不会写入分发清单。构建失败不会产生可用发行归档。可单独运行纯标准库校验：

```powershell
python .\image-studio\scripts\dlss5\bundle.py verify 'D:\BuildOutput\XAI-NR-1.0.0\bundle\dlss5'
```

将已构建的 x64 主程序与此 bundle 制成完整便携 ZIP：

```powershell
.\scripts\build-windows-engine-zip.ps1 `
  -BinaryPath '.\image-studio\build\bin\image-studio.exe' `
  -Dlss5BundlePath 'D:\BuildOutput\XAI-NR-1.0.0\bundle\dlss5' `
  -OutputZipPath 'D:\BuildOutput\image-studio-windows-amd64.zip'
```

该 helper 在复制前后验证清单并确认主程序为 AMD64，输出主程序与完整引擎，不调用 GPU。此普通 ZIP 依赖系统 WebView2；固定 WebView2 便携包和安装器沿用各自的 WebView2 处理。发布前仍须完成下面的实机验收。若为 worker/native 文件签名，应在生成 bundle manifest 前完成签名，否则文件摘要会失效。

## 应用发行布局与 CI

Windows x64 主 EXE 旁必须有完整 `runtimes/dlss5`。普通 ZIP、固定 WebView2 便携包、NSIS 和 MSIX 均携带同一树；不得只发一个 EXE 却宣称内置引擎可用。其他平台和 Windows ARM64 不包含此 Windows AMD64 NR 引擎。

manifest 合同：

```json
{"schemaVersion":1,"protocolVersion":1,"engineVersion":"DLSS5Tool-e23654c6/XAI-NR-1","bundleVersion":"1.0.0","platform":"windows","architecture":"amd64","executable":"worker/xai-video-engine.exe","toolRoot":"runtime","runtimePath":"runtime/nvngx_dlssnr.dll","files":[{"path":"worker/xai-video-engine.exe","sha256":"..."}]}
```

实际 `files` 必须覆盖除 manifest 自身外的全部文件，使用相对 POSIX 路径和小写 SHA256。校验拒绝路径逃逸、大小写重名、链接、未登记文件、缺文件、散列不符，以及非 AMD64 PE32+ 的 EXE/DLL/PYD。

生产入口为 [build-dlss5-engine.yml](../../../.github/workflows/build-dlss5-engine.yml)，仅支持默认分支的 `workflow_dispatch`，使用发布者控制的自托管 Windows x64 RTX runner（标签 `xai-dlss5-builder`）及 `dlss5-publisher` environment。维护者应给此 environment 配置审核规则。runner 服务环境须配置 `XAI_DLSS5_RUNTIME_SOURCE` 为可信运行库目录；可选 `XAI_DLSS5_BUILD_PYTHON` 为开发解释器。它不接收 runtime 下载 URL，也不运行于 PR。流程建立独立 venv、构建冻结 worker/清单/ZIP，执行真实 NR probe，并且只在 JSONL 明确返回唯一 `result.available: true` 时上传；仅退出码 0 不足以通过。私有 stderr 诊断不会进入 artifact，环境变量和凭据不会被收集。

成功 run 的摘要给出 `XAI_DLSS5_BUNDLE_RUN_ID`、`XAI_DLSS5_BUNDLE_ARTIFACT`、`XAI_DLSS5_BUNDLE_SHA256`，维护者将三项一起设为仓库 Actions variables。artifact 内是单个 `dlss5-bundle.zip`，默认保留 90 天；到期需重新构建并更新三项。发行 CI 只消费本仓库指定成功构建 run 的既有 artifact，下载后先比对指定归档 SHA256，再解包和校验 manifest。未配置、缺资产或校验失败会阻止 Windows x64 增强包发布，不会自动下载社区运行库或降为缺引擎版。构建 runtime artifact 的授权来源与审核由发布者负责。

## 发布验收与当前限制

必须在**干净 Windows x64、没有 Python、没有 DLSS5Tool**的机器上验证：安装 ZIP/NSIS/MSIX 后自动发现；真实 NR probe 和短片预览；自定义分辨率及整片音视频导出；只读安装目录；取消后无残留进程；升级/卸载处理完整 runtime 树。

当前环境完成了 bundle 的标准库回归和桥接模拟边界验证，未执行 Windows PyInstaller/安装包/GPU 验收，且未提供可再分发 NVIDIA 资产。因此“源码与封装架构已实现”不等于“真实内置引擎包已可发布”。增强版构建的失败门禁是为保留这一事实。
