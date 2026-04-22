// File summary:
// Electron Builder configuration for OpenVshot desktop packaging.

const isDirectMacDistribution = process.env.OPENVSHOT_MAC_DIRECT_DISTRIBUTION === "1";

const hasAppStoreConnectKey =
  Boolean(process.env.APPLE_API_KEY) &&
  Boolean(process.env.APPLE_API_KEY_ID) &&
  Boolean(process.env.APPLE_API_ISSUER);

const hasAppleIdCredentials =
  Boolean(process.env.APPLE_ID) &&
  Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD) &&
  Boolean(process.env.APPLE_TEAM_ID);

const hasNotarytoolProfile =
  Boolean(process.env.APPLE_KEYCHAIN_PROFILE) &&
  Boolean(process.env.APPLE_KEYCHAIN);

const shouldSignMac = Boolean(
  !isDirectMacDistribution &&
    (process.env.CSC_NAME || process.env.CSC_LINK || process.env.BUILD_CERTIFICATE_BASE64)
);

const shouldNotarizeMac = shouldSignMac && (hasAppStoreConnectKey || hasAppleIdCredentials || hasNotarytoolProfile);

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: "com.openvshot.desktop",
  productName: "OpenVshot",
  artifactName: "${productName}-${version}-${arch}.${ext}",
  directories: {
    output: "release",
  },
  files: ["dist/**/*", "electron/**/*", "package.json"],
  extraResources: [
    {
      from: "../../backend",
      to: "backend",
    },
    {
      from: "../../dist",
      to: "backend",
      filter: ["vshot.exe", "vshot"],
    },
    {
      from: "../../schema",
      to: "schema",
    },
    {
      from: "../../templates",
      to: "templates",
    },
  ],
  win: {
    icon: "build/icon.ico",
    target: ["nsis"],
  },
  mac: {
    icon: "build/icon.icns",
    target: isDirectMacDistribution ? ["zip"] : ["dmg", "zip"],
    category: "public.app-category.video",
    minimumSystemVersion: "11.0",
    hardenedRuntime: shouldSignMac,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    binaries: ["Contents/Resources/backend/vshot"],
    identity: shouldSignMac ? undefined : null,
    notarize: shouldNotarizeMac,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
    installerHeaderIcon: "build/icon.ico",
  },
};

module.exports = config;
