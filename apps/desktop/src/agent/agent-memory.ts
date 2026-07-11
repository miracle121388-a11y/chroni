import type { AgentMemory, AgentMemoryPatch } from "../shared/types.js";

export const defaultAgentMemory: AgentMemory = {
  maxDailyMinutes: 240,
  workdayStart: "09:00",
  workdayEnd: "18:00",
  reminderFrequency: "important-only",
};

export function createAgentMemory(value?: Partial<AgentMemory>): AgentMemory {
  return {
    ...defaultAgentMemory,
    ...(value ?? {}),
  };
}

export function updateAgentMemory(memory: AgentMemory, patch: AgentMemoryPatch): AgentMemory {
  return { ...memory, ...patch };
}
