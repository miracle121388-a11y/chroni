import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const petAssetMode = process.env.CHRONI_PET_ASSET_MODE?.trim() || "xiaotong";
const requestedVariant = process.env.CHRONI_BUILD_VARIANT?.trim();

if (petAssetMode !== "xiaotong" && petAssetMode !== "original") {
  throw new Error(`Unsupported CHRONI_PET_ASSET_MODE: ${petAssetMode}`);
}
if (requestedVariant && !["product", "goai", "store"].includes(requestedVariant)) {
  throw new Error(`Unsupported CHRONI_BUILD_VARIANT: ${requestedVariant}`);
}
const variant = requestedVariant || (petAssetMode === "xiaotong" ? "product" : "goai");
if (variant === "product" && petAssetMode !== "xiaotong") {
  throw new Error("Product builds require the xiaotong companion asset mode.");
}
if ((variant === "goai" || variant === "store") && petAssetMode !== "original") {
  throw new Error(`${variant} builds require the original Chroni asset mode.`);
}

const manifest = {
  schemaVersion: 1,
  productName: "Chroni",
  version: packageJson.version,
  variant,
  petAssetMode,
};
const output = join(desktop, "dist", "build-manifest.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Chroni ${manifest.variant} build manifest written: ${output}`);
