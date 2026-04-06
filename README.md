# SCU-OS v3.1 WebUI

## 运行方式
1. 安装依赖
   - `pip install -r requirements.txt`
2. 启动 WebUI
   - `streamlit run app.py`

## 桌面安装包构建
- 一键构建命令：
  - `powershell -ExecutionPolicy Bypass -File .\build_desktop_installer.ps1`
- 安装包输出：
  - `apps\desktop\release\OpenVshot Setup 0.1.0-beta.exe`
- 桌面端完整构建链位于：
  - `apps\desktop`

## macOS 桌面包构建
- 需要在 macOS 机器上执行，Windows 机器不能可靠产出可安装的 `.dmg`
- 目标用户不需要单独安装 Python；我们会先把后端打成原生可执行文件再一起封进桌面包
- 已补齐：
  - `.icns` 图标生成脚本：`build_macos_icon.sh`
  - 一键打包脚本：`build_desktop_installer_macos.sh`
  - `notarytool` 凭据写入脚本：`setup_macos_notarytool_profile.sh`
  - 签名/公证配置：`apps/desktop/build/entitlements.mac.plist`
- 构建机首次准备：
  - `python3 -m pip install -r requirements.txt`
  - 复制 `.mac-signing.env.example` 为 `.mac-signing.env`，按你的证书/公证方式填值
- 一键构建命令：
  - `bash ./build_desktop_installer_macos.sh`
- 产物位置：
  - `apps/desktop/release/`
- 说明：
  - 构建机需要已安装 `Python 3`，用于执行 `build_openvshot_macos.sh`
  - 一键脚本会先生成 `apps/desktop/build/icon.icns`
  - 一键脚本会先用 `PyInstaller` 生成 `dist/vshot`，再由 Electron Builder 打进 `.dmg/.zip`
  - 打包后的目标 Mac 不需要额外安装 Python
  - 如需临时调试脚本回退，可设置环境变量 `OPENVSHOT_ALLOW_SCRIPT_FALLBACK=1`
  - 可用 `OPENVSHOT_MAC_ARCH=arm64|x64|universal` 指定架构

## GitHub Actions
- 已新增工作流：
  - `.github/workflows/build-desktop.yml`
- 触发方式：
  - 推送到 `main`
  - 手动触发 `workflow_dispatch`
- 产物：
  - Windows：上传 `apps/desktop/release/*.exe`
  - macOS：上传 `apps/desktop/release/*.dmg` 和 `*.zip`
- 如需 macOS 签名/公证，请在 GitHub 仓库 Secrets 中配置：
  - `BUILD_CERTIFICATE_BASE64`
  - `P12_PASSWORD`
  - `KEYCHAIN_PASSWORD` (可选)
  - `CSC_NAME` (可选，建议填写)
  - `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`
  - 或 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
  - `APPLE_KEYCHAIN_PROFILE` / `APPLE_KEYCHAIN` 更适合本地 Mac，不建议作为 Actions 的首选方案

## macOS 签名与公证
- Electron Builder 会自动处理签名，前提是你的 Mac 钥匙串里已有 `Developer ID Application` 证书
- 公证支持三种方式，推荐按顺序使用：
  - App Store Connect API Key：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
  - Apple ID：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
  - notarytool profile：`APPLE_KEYCHAIN_PROFILE`、`APPLE_KEYCHAIN`
- 若你使用 Apple ID 流程，可先执行：
  - `bash ./setup_macos_notarytool_profile.sh`
- 一键脚本结束后会尝试执行：
  - `codesign --verify --deep --strict --verbose=2`
  - `spctl -a -vvv`
  - `xcrun stapler validate`

## OpenRouter 接入
- 推荐使用环境变量保存密钥：`OPENROUTER_API_KEY`
- 默认 API Base：`https://openrouter.ai/api/v1`
- 可选 Header：`HTTP-Referer` 与 `X-OpenRouter-Title`
- 模型发现：在“模型中心”拉取全量模型并按输出类型筛选
- 文本与图像在 WebUI 的“OpenRouter 生成”页完成调用
- 视频模型若不可自动发现，可手动填写 provider/model 占位

## MemeFast 接入
- 环境变量：`MEMEFAST_API_KEY`
- 默认 API Base：`https://memefast.top`
- 在“**MemeFast 模型**”页可拉取模型列表
- 在“**MemeFast 生成**”页完成文本/图像/视频调用（视频走 `/v1/videos`）

## 七牛 Kling 视频生成
- 七牛 Kling 接口基于七牛 AI 大模型推理 API
- 配置项在侧边栏“七牛 Kling 设置”中
- 建议通过环境变量配置：`QINIU_AI_API_KEY`
- Kling 支持图片 URL 或 **无前缀 base64**（不要 `data:image/...` 前缀）
- 视频生成与状态查询入口在“**Kling 视频生成**”页面

## 腾讯云 COS（图片资产管理）
- 可在“图片资产”页上传本地图片、生成 base64、或上传到 COS 获取 URL
- 建议通过环境变量配置：
  - `TENCENT_COS_SECRET_ID`
  - `TENCENT_COS_SECRET_KEY`
  - `TENCENT_COS_REGION`
  - `TENCENT_COS_BUCKET`
  - `TENCENT_COS_TOKEN` (可选)
  - `TENCENT_COS_ENDPOINT` (可选)
  - `TENCENT_COS_PUBLIC_URL` (可选)
  - `TENCENT_COS_PREFIX` (可选，默认 `assets/`)

## 火山云（Ark Runtime SDK）
- 安装：`pip install 'volcengine-python-sdk[ark]'`
- 支持 API Key 或 AK/SK：
  - `ARK_API_KEY`
  - `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`
- 默认 Base URL：`https://ark.cn-beijing.volces.com/api/v3`
- 入口在“**火山云 生成**”页面（文本/图像/视频）

## 本地 SQLite 持久化
- 侧边栏“本地 SQLite”可配置 DB 路径并手动保存/加载
- 默认路径：`scu_os.db`
- 支持保存角色/场景/镜头/资产/配置（包含密钥）
- 建议仅在可信环境中启用密钥持久化

## 说明
- 本工具将 SCU-OS 流程模块化为 WebUI 表单与导出功能
- 镜头清单 JSON 结构与 `schema/shot_list.schema.json` 对齐
- 当前版本为流程与结构化数据驱动，包含 OpenRouter 文本/图像调用与 COS 资产管理示例
- OpenRouter / MemeFast / 火山云的图像生成可直接关联角色/场景（支持新建）
