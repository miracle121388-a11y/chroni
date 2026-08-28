import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDirectory = resolve(process.argv[2] || "apps/desktop/dist-electron");
const platform = (process.argv[3] || "").trim().toLowerCase();
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const aliasesByPlatform = {
  windows: [
    [`Chroni-${version}-win-x64-setup.exe`, "Chroni-win-x64-setup.exe"],
    [`Chroni-${version}-win-x64-portable.exe`, "Chroni-win-x64-portable.exe"],
  ],
  macos: [
    [`Chroni-${version}-mac-universal.dmg`, "Chroni-mac-universal.dmg"],
  ],
};

const aliases = aliasesByPlatform[platform];
if (!aliases) {
  throw new Error(`Unsupported release alias platform: ${platform || "<empty>"}`);
}

for (const [sourceName, aliasName] of aliases) {
  const source = join(releaseDirectory, sourceName);
  const alias = join(releaseDirectory, aliasName);
  if (!existsSync(source)) throw new Error(`Release artifact is missing: ${source}`);
  copyFileSync(source, alias);
  if (statSync(source).size !== statSync(alias).size) {
    throw new Error(`Release alias size mismatch: ${basename(alias)}`);
  }
  console.log(`Created direct-download alias: ${aliasName}`);
}
