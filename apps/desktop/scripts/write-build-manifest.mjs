import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const petAssetMode = process.env.CHRONI_PET_ASSET_MODE?.trim() || "xiaotong";

if (petAssetMode !== "xiaotong" && petAssetMode !== "original") {
  throw new Error(`Unsupported CHRONI_PET_ASSET_MODE: ${petAssetMode}`);
}

const manifest = {
  schemaVersion: 1,
  productName: "Chroni",
  version: packageJson.version,
  variant: petAssetMode === "xiaotong" ? "product" : "goai",
  petAssetMode,
};
const output = join(desktop, "dist", "build-manifest.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Chroni ${manifest.variant} build manifest written: ${output}`);
