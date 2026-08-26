const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const unusedProtectedResourceKeys = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

function plutil(args, options = {}) {
  try {
    return execFileSync("/usr/bin/plutil", args, {
      encoding: "utf8",
      stdio: options.ignoreFailure ? "ignore" : ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (options.ignoreFailure) return "";
    throw error;
  }
}

function sanitizeMacInfoPlist(infoPlist) {
  if (process.platform !== "darwin" || !existsSync(infoPlist)) return;
  for (const key of unusedProtectedResourceKeys) {
    plutil(["-remove", key, infoPlist], { ignoreFailure: true });
  }
  try {
    plutil(["-extract", "NSAppTransportSecurity.NSAllowsArbitraryLoads", "raw", "-o", "-", infoPlist]);
    plutil(["-replace", "NSAppTransportSecurity.NSAllowsArbitraryLoads", "-bool", "NO", infoPlist]);
  } catch {
    // MAS bundles do not receive electron-builder's direct-download ATS block.
  }
}

async function afterPack(context) {
  if (process.platform !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  sanitizeMacInfoPlist(join(context.appOutDir, appName, "Contents", "Info.plist"));
}

module.exports = afterPack;
module.exports.sanitizeMacInfoPlist = sanitizeMacInfoPlist;
module.exports.unusedProtectedResourceKeys = unusedProtectedResourceKeys;
