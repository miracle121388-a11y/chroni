import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const productionCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

const devCsp = productionCsp
  .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
  .replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173");

export default defineConfig(({ command }) => {
  const petAssetMode = process.env.CHRONI_PET_ASSET_MODE?.trim() || "xiaotong";
  if (petAssetMode !== "original" && petAssetMode !== "xiaotong") {
    throw new Error(`Unsupported CHRONI_PET_ASSET_MODE: ${petAssetMode}`);
  }
  const petAssetModule = fileURLToPath(new URL(`./src/renderer/src/pet-assets/${petAssetMode}.ts`, import.meta.url));
  return ({
  root: "src/renderer",
  base: "./",
  resolve: {
    alias: {
      "virtual:chroni-pet-assets": petAssetModule,
    },
  },
  plugins: [
    react(),
    command === "serve" && {
      name: "chroni-dev-csp",
      transformIndexHtml(html: string) {
        return html.replace(productionCsp, devCsp);
      },
    },
  ].filter(Boolean),
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    // Keep every font shard as a local file. The production CSP deliberately
    // allows self-hosted fonts but not data: font URLs.
    assetsInlineLimit: 0,
  },
  });
});
