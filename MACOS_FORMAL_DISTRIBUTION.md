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
