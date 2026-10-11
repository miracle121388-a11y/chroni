import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export const VOICE_MODEL_ID = "onnx-community/whisper-base";
const revision = "1846881b6b3a3024392c1eea3ad983695bc23925";
// SHA-256 from the pinned public revision; ONNX hashes match its Git LFS OIDs.
export const voiceModelFiles = [
  { path: "config.json", bytes: 2243, sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b" },
  { path: "generation_config.json", bytes: 3832, sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0" },
  { path: "preprocessor_config.json", bytes: 339, sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" },
  { path: "tokenizer.json", bytes: 2480466, sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" },
  { path: "tokenizer_config.json", bytes: 282682, sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573" },
  { path: "onnx/encoder_model_quantized.onnx", bytes: 23201314, sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46" },
  { path: "onnx/decoder_model_merged_quantized.onnx", bytes: 53693315, sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b" },
] as const;

export async function isVerifiedModelFile(path: string, expected: { bytes: number; sha256: string }): Promise<boolean> {
  try {
    if ((await stat(path)).size !== expected.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === expected.sha256;
  } catch { return false; }
}

export async function downloadVerifiedModelFile(url: string, path: string, expected: { bytes: number; sha256: string }, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.download`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    const response = await fetchImpl(url, { signal: signal ?? AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("语音模型下载失败，请检查网络后重试。"); }
    let bytes = 0;
    const hash = createHash("sha256");
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > expected.bytes) throw new Error("语音模型文件大小不正确，请重试。");
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (bytes !== expected.bytes || hash.digest("hex") !== expected.sha256) throw new Error("语音模型下载不完整或校验失败，请重试。");
    await handle.close();
    await rename(temporary, path);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
  }
}

export async function prepareVoiceModel(cachePath: string, fetchImpl: typeof fetch, progress: (percentage: number) => void, signal: AbortSignal): Promise<string> {
  const root = join(cachePath, VOICE_MODEL_ID);
  for (const [index, file] of voiceModelFiles.entries()) {
    const path = join(root, file.path);
    if (!await isVerifiedModelFile(path, file)) {
      await downloadVerifiedModelFile(`https://huggingface.co/${VOICE_MODEL_ID}/resolve/${revision}/${file.path}`, path, file, fetchImpl, signal);
    }
    progress(Math.round((index + 1) / voiceModelFiles.length * 100));
  }
  return root;
}
