import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker, type InitOptions } from "tesseract.js";
import sharp from "sharp";

const require = createRequire(import.meta.url);

/** Materialize bundled data outside ASAR so the worker never needs a CDN. */
export function prepareOcrLanguages(cachePath: string): string {
  const destination = join(cachePath, "bundled-v1");
  mkdirSync(destination, { recursive: true });
  for (const language of ["chi_sim", "eng"]) {
    const source = join(dirname(require.resolve(`@tesseract.js-data/${language}`)), "4.0.0_best_int", `${language}.traineddata.gz`);
    const data = gunzipSync(readFileSync(source));
    const target = join(destination, `${language}.traineddata`);
    try {
      if (readFileSync(target).equals(data)) continue;
    } catch { /* Populate an empty cache on first use. */ }
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, data);
    renameSync(temporary, target);
  }
  return destination;
}

export async function recognizeDocumentImage(image: Buffer, cachePath: string): Promise<{ text: string; confidence: number }> {
  const langPath = prepareOcrLanguages(cachePath);
  // chi_sim otherwise requests an unbundled vertical model during initialization.
  const configuration: Partial<InitOptions> & Record<string, string> = { tessedit_load_sublangs: "" };
  const worker = await createWorker("eng+chi_sim", 1, {
    langPath, cachePath: langPath, gzip: false, cacheMethod: "none",
    // Tesseract otherwise throws worker errors outside the intake promise.
    errorHandler: () => undefined,
  }, configuration);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const images = await prepareImages(image);
    const results: Array<{ text: string; confidence: number }> = [];
    for (const prepared of images) {
      const recognize = async (input: Buffer) => {
        const result = await Promise.race([
          worker.recognize(input, { rotateAuto: true }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("图片识别超时，请裁剪或降低图片分辨率后重试。")), 90_000);
          }),
        ]);
        if (timeout) clearTimeout(timeout);
        return { text: result.data.text, confidence: result.data.confidence };
      };
      let best = await recognize(prepared);
      if (best.confidence < 70) {
        for (const angle of [90, 180, 270]) {
          const candidate = await recognize(await sharp(prepared).rotate(angle).png().toBuffer());
          if (candidate.confidence > best.confidence) best = candidate;
          if (best.confidence >= 80) break;
        }
      }
      if (best.text.trim()) results.push(best);
    }
    return { text: results.map((result) => result.text).join("\n\n"), confidence: results.length ? Math.min(...results.map((result) => result.confidence)) : 0 };
  } finally {
    if (timeout) clearTimeout(timeout);
    await worker.terminate();
  }
}

async function prepareImages(buffer: Buffer): Promise<Buffer[]> {
  // Skia's TIFF decoder can terminate the host process. Convert through libvips
  // before OCR; animated formats use their first frame, document TIFFs all pages.
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return [await prepareBitmap(buffer)];
  try {
    const metadata = await sharp(buffer, { limitInputPixels: 40_000_000 }).metadata();
    const pages = metadata.format === "tiff" ? metadata.pages ?? 1 : 1;
    if (pages > 60) throw new Error("多页 TIFF 过长，请拆分为每份最多 60 页后导入。");
    const images: Buffer[] = [];
    for (let page = 0; page < pages; page += 1) {
      const pipeline = sharp(buffer, { page, pages: 1, limitInputPixels: 40_000_000 }).rotate().flatten({ background: "white" });
      const width = metadata.width ?? 1800;
      const height = metadata.pageHeight ?? metadata.height ?? 1800;
      const scale = Math.min(width < 1000 ? Math.min(2, 1800 / width) : 1, 3600 / Math.max(width, height));
      images.push(await pipeline.resize(Math.round(width * scale), Math.round(height * scale), { fit: "inside" }).png().toBuffer());
    }
    return images;
  } catch (error) {
    if (error instanceof Error && error.message.includes("最多 60 页")) throw error;
    throw new Error("图片无法解码，请重新导出为 PNG 或 JPG 后导入（单页不超过 4000 万像素）。");
  }
}

async function prepareBitmap(buffer: Buffer): Promise<Buffer> {
  try {
    if (buffer.length < 26 || Math.abs(buffer.readInt32LE(18) * buffer.readInt32LE(22)) > 40_000_000) throw new Error("图片像素过多，请缩小到 4000 万像素以内后重试。");
    const image = await loadImage(buffer);
    if (image.width * image.height > 40_000_000) throw new Error("图片像素过多，请缩小到 4000 万像素以内后重试。");
    const scale = Math.min(image.width < 1000 ? Math.min(2, 1800 / image.width) : 1, 3600 / Math.max(image.width, image.height));
    const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toBuffer("image/png");
  } catch (error) {
    if (error instanceof Error && error.message.includes("图片像素过多")) throw error;
    throw new Error("BMP 图片无法解码，请重新导出为 PNG 或 JPG 后导入。");
  }
}
