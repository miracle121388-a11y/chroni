import assert from "node:assert/strict";
import test from "node:test";

import { reminderEligibility } from "../dist/agent/agent-reminder.js";

const now = new Date("2026-07-12T10:00:00.000Z");

test("Agent reminder eligibility reports every non-send reason", () => {
  assert.equal(reminderEligibility({ enabled: false, supported: true, inQuietHours: false, now }).reason, "disabled");
  assert.equal(reminderEligibility({ enabled: true, supported: false, inQuietHours: false, now }).reason, "unsupported");
  assert.equal(reminderEligibility({ enabled: true, supported: true, inQuietHours: true, now }).reason, "quiet-hours");
  assert.equal(reminderEligibility({ enabled: true, supported: true, inQuietHours: false, lastRemindedAt: "2026-07-12T09:00:00.000Z", now }).reason, "duplicate");
});

test("Agent reminder eligibility allows a new or sufficiently old reminder", () => {
  assert.deepEqual(reminderEligibility({ enabled: true, supported: true, inQuietHours: false, now }), { sent: true, reason: "sent" });
  assert.equal(reminderEligibility({ enabled: true, supported: true, inQuietHours: false, lastRemindedAt: "2026-07-12T05:00:00.000Z", now }).reason, "sent");
});
