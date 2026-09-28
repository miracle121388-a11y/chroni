// MAS ships the same approved companion and license notices as the product.
// Reuse the artwork digest/frame checks so this channel cannot drift.
process.argv.push("--store");
await import("./verify-product-assets.mjs");
