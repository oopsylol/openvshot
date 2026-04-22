# macOS 正式分发说明

## 目标

为 `OpenVshot` 生成可在现代 macOS 系统中正常下载安装的正式分发包。

正式分发必须同时满足以下条件：

1. 使用 `Developer ID Application` 证书完成签名。
2. 使用 Apple notarization 完成公证。
3. 对生成的 DMG 执行 stapler 校验。

## GitHub Secrets

至少需要一组签名凭据和一组公证凭据。

### 签名凭据

- `CSC_NAME`
- `CSC_LINK` 或 `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `KEYCHAIN_PASSWORD`

### 公证凭据

推荐使用 App Store Connect API key：

- `APPLE_API_KEY`
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`

备选使用 Apple ID：

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

备选使用 notarytool profile：

- `APPLE_KEYCHAIN_PROFILE`
- `APPLE_KEYCHAIN`

## 自动化导入

项目已提供自动化脚本：

- [prepare_github_macos_secrets.sh](file:///d:/wwwroot/video-creater/prepare_github_macos_secrets.sh)
- [setup_macos_formal_distribution.ps1](file:///d:/wwwroot/video-creater/setup_macos_formal_distribution.ps1)

如果你的日常开发机是 Windows，优先使用 PowerShell 脚本完成自动化。

## Windows 最短流程

### 1. 生成 CSR 和私钥

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_macos_formal_distribution.ps1 `
  -CreateCsr `
  -OutputDirectory .\macos-distribution `
  -CommonName "OpenVshot Developer ID" `
  -Organization "OpenVshot" `
  -OrganizationalUnit "Engineering"
```

执行完成后会生成：

1. `macos-distribution\developer_id_private.key`
2. `macos-distribution\developer_id_request.csr`

将 `developer_id_request.csr` 上传到 Apple Developer 后台申请 `Developer ID Application` 证书。

### 2. 下载证书后生成 P12

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_macos_formal_distribution.ps1 `
  -CreateP12 `
  -PrivateKeyPath .\macos-distribution\developer_id_private.key `
  -CertificatePath .\Downloads\developerID_application.cer `
  -OutputDirectory .\macos-distribution
```

脚本会提示输入 `P12` 密码，并输出 `openvshot-developer-id.p12`。

### 3. 一键导入 GitHub Secrets

```powershell
powershell -ExecutionPolicy Bypass -File .\setup_macos_formal_distribution.ps1 `
  -ImportSecrets `
  -Repo oopsylol/openvshot `
  -CertificateName "Developer ID Application: Your Company (TEAMID1234)" `
  -P12Path .\macos-distribution\openvshot-developer-id.p12 `
  -ApiKeyFile .\Downloads\AuthKey_ABC123XYZ.p8 `
  -ApiKeyId ABC123XYZ `
  -ApiIssuer 00000000-0000-0000-0000-000000000000 `
  -Apply
```

执行后会自动写入这些 Secrets：

1. `CSC_NAME`
2. `BUILD_CERTIFICATE_BASE64`
3. `P12_PASSWORD`
4. `KEYCHAIN_PASSWORD`
5. `APPLE_API_KEY`
6. `APPLE_API_KEY_ID`
7. `APPLE_API_ISSUER`

在你的 Mac 上准备好以下文件后即可运行：

1. 已导出的 `Developer ID Application` 证书 `.p12`
2. `App Store Connect API Key` 的 `.p8` 文件
3. `Key ID`
4. `Issuer ID`

示例命令：

```bash
bash ./prepare_github_macos_secrets.sh \
  --repo oopsylol/openvshot \
  --p12 ~/Desktop/openvshot-dev-id.p12 \
  --api-key-file ~/Downloads/AuthKey_ABC123XYZ.p8 \
  --api-key-id ABC123XYZ \
  --api-issuer 00000000-0000-0000-0000-000000000000 \
  --apply
```

脚本会自动完成以下动作：

1. 检测本机 `Developer ID Application` 证书名称
2. 将 `.p12` 转为 `BUILD_CERTIFICATE_BASE64`
3. 读取 `.p8` 文件内容作为 `APPLE_API_KEY`
4. 自动生成 `KEYCHAIN_PASSWORD`
5. 通过 `gh secret set` 写入 GitHub Actions secrets

如果不加 `--apply`，脚本会只生成一份可执行导入脚本，方便你复核后手动执行。

## 仍需人工完成的 Apple 步骤

以下动作仍然必须你自己在 Apple 后台点击完成，无法在本仓库内全自动完成：

1. 在 Apple Developer 中上传 CSR 申请 `Developer ID Application` 证书
2. 下载 Apple 返回的证书文件
3. 在 App Store Connect 中创建 API Key 并下载 `.p8`

## 当前发布策略

`release` workflow 已启用正式分发保护：

1. 缺少签名凭据时直接失败。
2. 缺少公证凭据时直接失败。
3. 签名校验失败时直接失败。
4. notarization ticket 校验失败时直接失败。

这样可以避免未签名或未公证的 macOS 安装包被错误发布。

## 本地验证命令

在 macOS 上构建完成后，建议执行：

```bash
codesign --verify --deep --strict --verbose=2 /path/to/OpenVshot.app
spctl -a -vvv /path/to/OpenVshot.app
xcrun stapler validate /path/to/OpenVshot.dmg
```

如果 `spctl` 或 `stapler` 失败，不应将该包作为正式版分发。

## 常见现象

如果用户看到：

```text
“OpenVshot” 已损坏，无法打开。
```

通常表示以下问题之一：

1. 应用未签名。
2. 应用已签名但未公证。
3. DMG 未 stapler。
4. 下载后仍带有 quarantine 隔离属性，仅适用于本机临时放行，不适用于正式分发。
