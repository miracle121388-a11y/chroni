const hasCodeSigningCertificate = Boolean(process.env.CSC_LINK?.trim());
const hasMacCertificate = process.platform === "darwin" && hasCodeSigningCertificate;
const hasAppleApiCredentials = Boolean(
  process.env.APPLE_API_KEY?.trim()
  && process.env.APPLE_API_KEY_ID?.trim()
  && process.env.APPLE_API_ISSUER?.trim(),
);
const hasAppleIdCredentials = Boolean(
  process.env.APPLE_ID?.trim()
  && process.env.APPLE_APP_SPECIFIC_PASSWORD?.trim()
  && process.env.APPLE_TEAM_ID?.trim(),
);
const requireSigning = process.env.CHRONI_REQUIRE_SIGNING === "1";
const requireNotarization = process.env.CHRONI_REQUIRE_NOTARIZATION === "1";
const canNotarize = hasMacCertificate && (hasAppleApiCredentials || hasAppleIdCredentials);

if (process.platform === "darwin" && requireSigning && !hasMacCertificate) {
  throw new Error("CHRONI_REQUIRE_SIGNING=1, but CSC_LINK is not configured.");
}
if (process.platform === "darwin" && requireNotarization && !canNotarize) {
  throw new Error("CHRONI_REQUIRE_NOTARIZATION=1, but macOS signing or Apple notarization credentials are missing.");
}

module.exports = {
  appId: "app.chroni.desktop",
  productName: "Chroni",
  executableName: "Chroni",
  copyright: "Copyright © 2026 Chroni contributors",
  directories: {
    output: "dist-electron",
  },
  artifactName: "Chroni-${version}-${os}-${arch}.${ext}",
  files: [
    "dist/**",
    "third_party/**",
    "preload.cjs",
    "package.json",
  ],
  extraResources: [
    { from: "../../LICENSE", to: "licenses/CHRONI-MIT-LICENSE.txt" },
    { from: "third_party/xiaotong/LICENSE", to: "licenses/XIAOTONG-APACHE-2.0.txt" },
    { from: "third_party/xiaotong/ADDITIONAL_TERMS.md", to: "licenses/XIAOTONG-ADDITIONAL-TERMS.md" },
    { from: "third_party/xiaotong/README.md", to: "licenses/XIAOTONG-NOTICE.md" },
    { from: "third_party/fonts/OFL-1.1.txt", to: "licenses/FONTS-SIL-OFL-1.1.txt" },
    { from: "third_party/fonts/NOTICE.md", to: "licenses/FONT-NOTICE.md" },
  ],
  asar: true,
  compression: "maximum",
  npmRebuild: false,
  forceCodeSigning: requireSigning,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  publish: {
    provider: "github",
    owner: "miracle121388-a11y",
    repo: "chroni",
    releaseType: "release",
  },
  mac: {
    icon: "build/icon.icns",
    category: "public.app-category.productivity",
    minimumSystemVersion: "12.0",
    target: ["dmg", "zip"],
    x64ArchFiles: "**/node_modules/@napi-rs/canvas-darwin-*/**",
    identity: hasMacCertificate ? undefined : "-",
    hardenedRuntime: hasMacCertificate,
    gatekeeperAssess: false,
    notarize: canNotarize,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
  },
  dmg: {
    title: "Chroni ${version}",
    icon: "build/icon.icns",
    backgroundColor: "#f7f5ef",
    contents: [
      { x: 150, y: 190, type: "file" },
      { x: 450, y: 190, type: "link", path: "/Applications" },
    ],
  },
  win: {
    icon: "build/icon.ico",
    extraResources: [
      { from: "build/icon.ico", to: "icon.ico" },
    ],
    target: ["nsis", "portable"],
    requestedExecutionLevel: "asInvoker",
    verifyUpdateCodeSignature: hasCodeSigningCertificate,
  },
  nsis: {
    artifactName: "Chroni-${version}-win-${arch}-setup.${ext}",
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: "always",
    createStartMenuShortcut: true,
    shortcutName: "Chroni",
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: true,
    license: "../../LICENSE",
    installerIcon: "build/icon.ico",
    uninstallerIcon: "build/icon.ico",
  },
  portable: {
    artifactName: "Chroni-${version}-win-${arch}-portable.${ext}",
    requestExecutionLevel: "user",
  },
  linux: {
    target: ["AppImage", "deb", "tar.gz"],
    category: "Utility",
    maintainer: "Chroni contributors",
  },
};
