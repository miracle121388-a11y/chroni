import type { AgentReminderResult } from "./agent-tools.js";

export type AgentReminderEligibility = {
  enabled: boolean;
  supported: boolean;
  inQuietHours: boolean;
  lastRemindedAt?: string;
  now: Date;
};

export function reminderEligibility(input: AgentReminderEligibility): AgentReminderResult {
  if (!input.enabled) return { sent: false, reason: "disabled" };
  if (!input.supported) return { sent: false, reason: "unsupported" };
  if (input.inQuietHours) return { sent: false, reason: "quiet-hours" };
  const last = input.lastRemindedAt ? new Date(input.lastRemindedAt).getTime() : Number.NaN;
  if (Number.isFinite(last) && input.now.getTime() - last < 4 * 60 * 60 * 1_000) return { sent: false, reason: "duplicate" };
  return { sent: true, reason: "sent" };
}
