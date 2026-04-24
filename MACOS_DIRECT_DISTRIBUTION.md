# macOS 直接分发说明

## 目标

`OpenVshot` 采用开源软件直接分发模式发布到 `GitHub Release`，不依赖 Apple Developer 签名或 notarization。

## 发布产物

macOS 发布任务会生成以下文件：

1. `OpenVshot-<version>-<arch>.dmg`
2. `OpenVshot-<version>-<arch>.zip`
3. `openvshot-macos-direct-support.zip`
4. `openvshot-cli-macos-<arch>`
5. `openvshot-cli-macos-<arch>.tar.gz`

其中 `openvshot-macos-direct-support.zip` 包含：

1. `OpenVshot-First-Run.command`
2. `OpenVshot-macos-direct-distribution.txt`

## 用户安装步骤

1. 优先从 `GitHub Release` 下载 `OpenVshot` 的 macOS `dmg`
2. 挂载后将 `OpenVshot.app` 拖到 `/Applications`
3. 如果 `dmg` 挂载或复制不顺利，再改用 macOS `zip`
4. 解压 `openvshot-macos-direct-support.zip`
5. 双击运行 `OpenVshot-First-Run.command`

该命令会执行：

```bash
xattr -dr com.apple.quarantine /Applications/OpenVshot.app
open /Applications/OpenVshot.app
```

如果系统仍然阻止启动，用户可以对 `OpenVshot.app` 执行右键 `Open`。

## 当前分发策略

1. `GitHub Actions` 不再依赖 Apple Secrets
2. macOS 构建默认生成 `dmg + zip` 直发包
3. Release 中附带首次运行放行脚本
4. `dmg` 仅作为开源软件分发介质，不包含 Apple 公证

## 适用场景

适用于开源软件、内部测试版、社区分发版。

如果未来需要让用户下载后直接双击运行且不出现系统提示，再切回 Apple Developer 签名和 notarization 流程。
