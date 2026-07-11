import type { AgentTraceEntry, AgentTraceStage } from "../shared/types.js";

export type AgentTraceRecorder = {
  record(stage: AgentTraceStage, summary: string, data?: AgentTraceEntry["data"], success?: boolean): AgentTraceEntry;
  entries(): AgentTraceEntry[];
};

export function createTraceRecorder(now: () => string = () => new Date().toISOString()): AgentTraceRecorder {
  const trace: AgentTraceEntry[] = [];
  return {
    record(stage, summary, data = {}, success = true) {
      const sequence = trace.length + 1;
      const entry: AgentTraceEntry = {
        id: `trace-${sequence}`,
        sequence,
        stage,
        timestamp: now(),
        summary,
        success,
        data: { ...data },
      };
      trace.push(entry);
      return entry;
    },
    entries: () => trace.map((entry) => ({ ...entry, data: { ...entry.data } })),
  };
}
