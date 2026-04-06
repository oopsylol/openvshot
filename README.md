# OpenVshot CLI

一个简单的、基于火山方舟大模型的 CLI 短视频生成工具。

## 功能
- 用命令行完成短视频脚本、镜头、生成任务的驱动
- 基于火山方舟模型完成文本与视频能力调用
- 支持把 CLI 打包成可执行文件，方便直接分发使用

## 环境要求
- Python 3.10+
- 已安装项目依赖：`pip install -r requirements.txt`
- 火山方舟 API Key 和对应模型配置

## 快速开始
- 查看帮助：
  - `python scu_cli.py --help`
- 查看版本：
  - `python scu_cli.py --version`
- 首次配置：
  - `python scu_cli.py setup`

## 可执行文件
- Windows CLI 可执行文件：
  - `powershell -ExecutionPolicy Bypass -File .\build_openvshot_exe.ps1`
- Windows CLI 发布包：
  - `powershell -ExecutionPolicy Bypass -File .\build_cli_bundle_windows.ps1`
- macOS CLI 可执行文件：
  - `bash ./build_openvshot_macos.sh`
- macOS CLI 发布包：
  - `bash ./build_cli_bundle_macos.sh`

## 配置说明
- 主要使用火山方舟配置：
  - `ARK_API_KEY`
  - `ARK_BASE_URL`
  - `VOLC_TEXT_MODEL`
  - `VOLC_VIDEO_MODEL`

## 说明
- 当前项目主定位是 CLI 工具
- 如需查看所有命令，请以 `python scu_cli.py --help` 输出为准
