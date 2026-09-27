import { execFileSync } from "node:child_process";

// A provisioning profile contains date and certificate-data values that plutil
// cannot convert wholesale to JSON. Extract only the fields needed for checks.
export function readMacOSProfile(path) {
  const input = execFileSync("security", ["cms", "-D", "-i", path]);
  const extract = (key, format) => execFileSync("plutil", ["-extract", key, format, "-o", "-", "-"], {
    input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  return {
    Name: extract("Name", "raw"),
    TeamIdentifier: JSON.parse(extract("TeamIdentifier", "json")),
    Entitlements: JSON.parse(extract("Entitlements", "json")),
    ExpirationDate: extract("ExpirationDate", "raw"),
  };
}
