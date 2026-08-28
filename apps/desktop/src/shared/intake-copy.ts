import type { IntakePayload } from "./types.js";

export type IntakeProgressPhase = "import" | "preview";

export function intakeProgressMessage(payload: IntakePayload, phase: IntakeProgressPhase = "import"): string {
  if (payload.kind === "text") return phase === "preview" ? "正在预览日程信息…" : "正在理解日程…";

  const count = payload.files?.length ?? 0;
  const fileLabel = count > 0 ? ` ${count} 个文件` : "文件";
  return phase === "preview"
    ? `正在预览${fileLabel}中的日程与任务…`
    : `正在识别${fileLabel}中的日程与任务…`;
}

export const REPROCESS_PROGRESS_MESSAGE = "正在重新识别日程与任务…";
export const EMPTY_INTAKE_PROMPT = "把日程、课程要求、截图或项目材料拖给我。";
