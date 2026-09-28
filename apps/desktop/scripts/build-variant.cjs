// One asset contract for renderer, manifest, and packaging. Store distribution
// changes signing/update behavior, never the approved companion appearance.
function resolveBuildVariant(env = process.env) {
  const petAssetMode = env.CHRONI_PET_ASSET_MODE?.trim() || "xiaotong";
  if (!["xiaotong", "original"].includes(petAssetMode)) {
    throw new Error(`Unsupported CHRONI_PET_ASSET_MODE: ${petAssetMode}`);
  }
  const variant = env.CHRONI_BUILD_VARIANT?.trim() || (petAssetMode === "original" ? "goai" : "product");
  if (!["product", "store", "goai"].includes(variant)) {
    throw new Error(`Unsupported CHRONI_BUILD_VARIANT: ${variant}`);
  }
  const requiredMode = variant === "goai" ? "original" : "xiaotong";
  if (petAssetMode !== requiredMode) {
    throw new Error(`${variant} builds require ${requiredMode} companion assets; refusing an appearance fallback.`);
  }
  return { variant, petAssetMode };
}
module.exports = { resolveBuildVariant };
