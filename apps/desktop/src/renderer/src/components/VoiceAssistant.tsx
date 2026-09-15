import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { formatOperationError } from "../../../shared/errors";
import type { ChroniSnapshot, VoiceCommandPreview, VoiceEngineStatus } from "../../../shared/types";
import { UiIcon } from "./UiIcon";

const api = window.chroni;
const TARGET_SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 30_000;

type VoicePhase = "idle" | "listening" | "transcribing" | "interpreting" | "executing" | "error";

type RecorderSession = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  gain: GainNode;
  stream: MediaStream;
  chunks: Float32Array[];
  inputSampleRate: number;
};

export function VoiceAssistant({
  snapshot,
  setSnapshot,
  openSignal,
  onNavigate,
}: {
  snapshot: ChroniSnapshot;
  setSnapshot: Dispatch<SetStateAction<ChroniSnapshot | null>>;
  openSignal: number;
  onNavigate(tab: "missions" | "schedule" | "daily" | "review" | "preferences" | "services"): void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState<VoiceCommandPreview | null>(null);
  const [feedback, setFeedback] = useState("");
  const [engine, setEngine] = useState<VoiceEngineStatus>({ state: "idle", modelId: "onnx-community/whisper-tiny", message: "本地语音模型尚未载入。" });
  const recorder = useRef<RecorderSession | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const textInput = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;
    void api.getVoiceStatus().then((status) => { if (active) setEngine(status); }).catch(() => undefined);
    const unsubscribe = api.onVoiceStatus((status) => { if (active) setEngine(status); });
    return () => {
      active = false;
      unsubscribe();
      void discardRecording();
    };
  }, []);

  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
    window.setTimeout(() => textInput.current?.focus(), 80);
  }, [openSignal]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (phase === "listening") void stopRecording();
      else closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, phase]);

  async function startRecording(): Promise<void> {
    if (phase !== "idle" && phase !== "error") return;
    setFeedback("");
    setPreview(null);
    window.speechSynthesis?.cancel();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4_096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        if (!recorder.current || recorder.current.chunks !== chunks) return;
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);
      recorder.current = { context, source, processor, gain, stream, chunks, inputSampleRate: context.sampleRate };
      setPhase("listening");
      recordingTimer.current = window.setTimeout(() => void stopRecording(), MAX_RECORDING_MS);
    } catch (error) {
      setPhase("error");
      setFeedback(microphoneError(error));
    }
  }

  async function stopRecording(): Promise<void> {
    const session = recorder.current;
    if (!session) return;
    recorder.current = null;
    clearRecordingTimer();
    session.processor.onaudioprocess = null;
    session.source.disconnect();
    session.processor.disconnect();
    session.gain.disconnect();
    session.stream.getTracks().forEach((track) => track.stop());
    await session.context.close().catch(() => undefined);
    const input = concatenateAudio(session.chunks);
    const samples = resampleAudio(input, session.inputSampleRate, TARGET_SAMPLE_RATE);
    if (samples.length < TARGET_SAMPLE_RATE / 3) {
      setPhase("error");
      setFeedback("录音太短，请说完一句话后再松开。");
      return;
    }
    setPhase("transcribing");
    try {
      const result = await api.transcribeVoice(samples, TARGET_SAMPLE_RATE);
      setDraft(result.text);
      await interpret(result.text);
    } catch (error) {
      setPhase("error");
      setFeedback(formatOperationError(error, "本地语音转写未完成，请重试或直接输入命令"));
    }
  }

  async function discardRecording(): Promise<void> {
    const session = recorder.current;
    recorder.current = null;
    clearRecordingTimer();
    if (!session) return;
    session.processor.onaudioprocess = null;
    session.source.disconnect();
    session.processor.disconnect();
    session.gain.disconnect();
    session.stream.getTracks().forEach((track) => track.stop());
    await session.context.close().catch(() => undefined);
  }

  function clearRecordingTimer(): void {
    if (recordingTimer.current !== null) window.clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
  }

  async function interpret(text = draft): Promise<void> {
    const command = text.trim();
    if (!command) {
      setPhase("error");
      setFeedback("请先说出或输入一句指令。");
      return;
    }
    setPhase("interpreting");
    setFeedback("");
    try {
      const next = await api.previewVoiceCommand(command);
      setPreview(next);
      setPhase(next.state === "error" ? "error" : "idle");
      if (next.state === "navigation" && next.navigateTo) onNavigate(next.navigateTo);
      if (next.state !== "confirmation") speak(next.spokenText);
    } catch (error) {
      setPhase("error");
      setFeedback(formatOperationError(error, "暂时无法理解这条指令"));
    }
  }

  async function confirm(): Promise<void> {
    if (!preview?.id || phase === "executing") return;
    setPhase("executing");
    setFeedback("");
    try {
      const result = await api.confirmVoiceCommand(preview.id);
      setSnapshot(result.snapshot);
      setPreview({ kind: result.kind, state: result.ok ? "answer" : "error", title: result.title, message: result.message, spokenText: result.spokenText, details: [] });
      setPhase(result.ok ? "idle" : "error");
      speak(result.spokenText);
    } catch (error) {
      setPhase("error");
      setFeedback(formatOperationError(error, "指令没有执行，请重试"));
    }
  }

  async function cancelPreview(): Promise<void> {
    const id = preview?.id;
    setPreview(null);
    setPhase("idle");
    if (!id) return;
    try {
      setSnapshot(await api.cancelVoiceCommand(id));
    } catch {
      // A cancellation is best-effort; an expired preview cannot execute.
    }
  }

  function speak(text: string): void {
    if (!snapshot.preferences.voiceRepliesEnabled || !text.trim() || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 500));
    utterance.lang = "zh-CN";
    utterance.rate = 1.02;
    utterance.pitch = 0.96;
    const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.lang.toLowerCase().startsWith("zh"));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function closePanel(): void {
    void discardRecording();
    window.speechSynthesis?.cancel();
    setOpen(false);
    setPhase("idle");
    setFeedback("");
  }

  const busy = phase === "transcribing" || phase === "interpreting" || phase === "executing";
  const phaseLabel = voicePhaseLabel(phase, engine);
  return (
    <>
      <button
        className={`voice-orb ${open ? "active" : ""} ${phase === "listening" ? "listening" : ""}`}
        type="button"
        title="语音助手"
        aria-label={open ? "关闭语音助手" : "打开语音助手"}
        aria-expanded={open}
        disabled={!snapshot.preferences.voiceAssistantEnabled}
        onClick={() => open ? closePanel() : setOpen(true)}
      >
        <UiIcon name="microphone" />
        {phase === "listening" && <span aria-hidden="true" />}
      </button>
      {open && (
        <aside className="voice-panel" aria-label="Chroni 语音助手">
          <header className="voice-panel-head">
            <div>
              <span className={`voice-presence state-${phase}`} aria-hidden="true"><i /><i /><i /></span>
              <div><h2>语音助手</h2><p>{phaseLabel}</p></div>
            </div>
            <button type="button" className="voice-icon-button" title="关闭" aria-label="关闭语音助手" onClick={closePanel}><UiIcon name="close" /></button>
          </header>

          <form className="voice-compose" onSubmit={(event) => { event.preventDefault(); void interpret(); }}>
            <textarea
              ref={textInput}
              value={draft}
              maxLength={500}
              rows={2}
              disabled={busy || phase === "listening"}
              placeholder="说出安排，或直接输入一句话"
              aria-label="语音命令文字"
              onChange={(event) => { setDraft(event.target.value); setPreview(null); if (phase === "error") setPhase("idle"); setFeedback(""); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void interpret();
                }
              }}
            />
            <button className="voice-send" type="submit" disabled={busy || phase === "listening" || !draft.trim()} title="发送" aria-label="发送命令"><UiIcon name="arrow-up" /></button>
          </form>

          {preview?.state !== "confirmation" && (
            <div className="voice-capture-zone">
              <button
                className={`voice-record ${phase === "listening" ? "recording" : ""}`}
                type="button"
                disabled={busy}
                onClick={() => phase === "listening" ? void stopRecording() : void startRecording()}
                aria-label={phase === "listening" ? "结束录音" : "开始录音"}
              >
                <UiIcon name={phase === "listening" ? "stop" : "microphone"} />
              </button>
              <p>{phase === "listening" ? "说完后点击停止" : busy ? phaseLabel : "点击后说出一句完整指令"}</p>
              {engine.state === "loading" && <progress max="100" value={engine.progress ?? 0} aria-label="本地语音模型下载进度" />}
            </div>
          )}

          {!preview && !feedback && phase === "idle" && (
            <div className="voice-suggestions" aria-label="常用语音指令">
              {["今天有什么安排", "总结今天", "帮我安排今天"].map((example) => (
                <button key={example} type="button" onClick={() => { setDraft(example); void interpret(example); }}>{example}</button>
              ))}
            </div>
          )}

          {preview && (
            <section className={`voice-result result-${preview.state}`} aria-live="polite">
              <div className="voice-result-mark" aria-hidden="true"><UiIcon name={preview.state === "error" ? "close" : preview.state === "confirmation" ? "spark" : "check"} /></div>
              <div className="voice-result-copy">
                <h3>{preview.title}</h3>
                <p>{preview.message}</p>
                {preview.details.length > 0 && <ul>{preview.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
              </div>
              {preview.state === "confirmation" && (
                <div className="voice-confirm-actions">
                  <button type="button" className="secondary" disabled={phase === "executing"} onClick={() => void cancelPreview()}>取消</button>
                  <button type="button" className="primary" disabled={phase === "executing"} onClick={() => void confirm()}>{phase === "executing" ? "执行中" : "确认执行"}</button>
                </div>
              )}
            </section>
          )}

          {feedback && <p className="voice-error" role="alert">{feedback}</p>}

          {snapshot.voiceHistory.length > 0 && phase === "idle" && preview?.state !== "confirmation" && (
            <div className="voice-history">
              <span>最近执行</span>
              <p>{snapshot.voiceHistory[0].summary}</p>
              <time>{formatHistoryTime(snapshot.voiceHistory[0].createdAt)}</time>
            </div>
          )}

          <footer className="voice-privacy"><UiIcon name="shield" /><span>录音仅用于本地转写，不保存音频</span></footer>
        </aside>
      )}
    </>
  );
}

function concatenateAudio(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resampleAudio(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input;
  if (inputRate < outputRate || !Number.isFinite(inputRate)) throw new Error("当前麦克风采样率暂不支持。");
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let sample = start; sample < end && sample < input.length; sample += 1) sum += input[sample];
    output[index] = sum / Math.max(1, Math.min(end, input.length) - start);
  }
  return output;
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "麦克风权限未开启，请在系统隐私设置中允许 Chroni 使用麦克风。";
  if (error instanceof DOMException && error.name === "NotFoundError") return "没有找到可用麦克风，请连接设备后重试。";
  return formatOperationError(error, "无法启动麦克风，请检查设备后重试");
}

function voicePhaseLabel(phase: VoicePhase, engine: VoiceEngineStatus): string {
  if (phase === "listening") return "正在聆听";
  if (phase === "transcribing") return engine.state === "loading" ? engine.message : "正在本地转写";
  if (phase === "interpreting") return "正在理解指令";
  if (phase === "executing") return "正在执行";
  if (phase === "error") return "需要再试一次";
  return engine.state === "ready" ? "本地语音已就绪" : engine.state === "loading" ? engine.message : "随时可以开始";
}

function formatHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
