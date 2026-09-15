import { mkdirSync } from "node:fs";
import type { AutomaticSpeechRecognitionPipelineType } from "@huggingface/transformers";
import type { VoiceEngineStatus, VoiceTranscriptionResult } from "./shared/types.js";

const VOICE_MODEL_ID = "onnx-community/whisper-tiny";
const VOICE_SAMPLE_RATE = 16_000;
const MAX_AUDIO_SECONDS = 35;

type ProgressInfo = {
  status?: unknown;
  progress?: unknown;
};

export class LocalVoiceTranscriber {
  #status: VoiceEngineStatus = {
    state: "idle",
    modelId: VOICE_MODEL_ID,
    message: "本地语音模型尚未载入。",
  };
  #transcriber?: AutomaticSpeechRecognitionPipelineType;
  #loading?: Promise<AutomaticSpeechRecognitionPipelineType>;

  constructor(
    readonly cachePath: string,
    readonly onStatus: (status: VoiceEngineStatus) => void = () => undefined,
  ) {
    mkdirSync(cachePath, { recursive: true });
  }

  status(): VoiceEngineStatus {
    return { ...this.#status };
  }

  async transcribe(samples: Float32Array, sampleRate: number): Promise<VoiceTranscriptionResult> {
    if (sampleRate !== VOICE_SAMPLE_RATE) throw new Error("语音采样率无效，请重新录音。");
    if (samples.length < VOICE_SAMPLE_RATE / 3) throw new Error("录音太短，请按住麦克风说完一句话。");
    if (samples.length > VOICE_SAMPLE_RATE * MAX_AUDIO_SECONDS) throw new Error(`单次语音请控制在 ${MAX_AUDIO_SECONDS} 秒内。`);
    if (!samples.every(Number.isFinite)) throw new Error("录音数据无效，请检查麦克风后重试。");
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    if (rms < 0.0025) throw new Error("没有检测到清晰声音，请靠近麦克风再说一次。");
    const transcriber = await this.#load();
    try {
      const output = await transcriber(samples, {
        language: "chinese",
        task: "transcribe",
        return_timestamps: false,
      });
      const first = Array.isArray(output) ? output[0] : output;
      const text = first?.text?.trim().replace(/^[，。！？,.!?\s]+|[\s]+$/g, "") ?? "";
      if (!text) throw new Error("没有听清内容，请靠近麦克风再说一次。");
      return {
        text,
        durationMs: Math.round(samples.length / VOICE_SAMPLE_RATE * 1_000),
        engine: "local-whisper",
      };
    } catch (error) {
      if (error instanceof Error && /没有听清|录音|麦克风/.test(error.message)) throw error;
      throw new Error("本地语音转写未完成，请重试或直接输入命令。");
    }
  }

  async #load(): Promise<AutomaticSpeechRecognitionPipelineType> {
    if (this.#transcriber) return this.#transcriber;
    if (this.#loading) return this.#loading;
    this.#setStatus({ state: "loading", modelId: VOICE_MODEL_ID, progress: 0, message: "正在准备本地语音模型，首次使用需要下载。" });
    this.#loading = import("@huggingface/transformers").then(({ env, pipeline }) => {
      env.cacheDir = this.cachePath;
      env.allowRemoteModels = true;
      env.allowLocalModels = true;
      return pipeline("automatic-speech-recognition", VOICE_MODEL_ID, {
        device: "cpu",
        dtype: "q8",
        progress_callback: (value: ProgressInfo) => {
          if (value.status === "progress" && typeof value.progress === "number") {
            const progress = Math.max(0, Math.min(100, Math.round(value.progress)));
            this.#setStatus({ state: "loading", modelId: VOICE_MODEL_ID, progress, message: `正在准备本地语音模型 ${progress}%` });
          }
        },
      });
    }).then((loaded) => {
      this.#transcriber = loaded;
      this.#setStatus({ state: "ready", modelId: VOICE_MODEL_ID, progress: 100, message: "本地语音模型已就绪。" });
      return loaded;
    }).catch((error) => {
      this.#setStatus({ state: "error", modelId: VOICE_MODEL_ID, message: "本地语音模型准备失败，请检查网络后重试。" });
      this.#loading = undefined;
      throw error;
    });
    return this.#loading;
  }

  #setStatus(status: VoiceEngineStatus): void {
    this.#status = status;
    this.onStatus({ ...status });
  }
}

export function validateVoiceAudio(value: unknown, sampleRate: unknown): { samples: Float32Array; sampleRate: number } {
  if (!(value instanceof Float32Array)) throw new Error("录音格式无效，请重新录音。");
  if (!Number.isInteger(sampleRate) || sampleRate !== VOICE_SAMPLE_RATE) throw new Error("语音采样率无效，请重新录音。");
  const samples = new Float32Array(value);
  if (samples.byteLength > VOICE_SAMPLE_RATE * MAX_AUDIO_SECONDS * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`单次语音请控制在 ${MAX_AUDIO_SECONDS} 秒内。`);
  }
  return { samples, sampleRate: sampleRate as number };
}
