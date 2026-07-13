import assert from "node:assert/strict";
import test from "node:test";

import {
  attentionPetAction,
  basePetAction,
  inputPetAction,
  isOneShotPetAction,
  petMotionReducer,
  resolvedPetAction,
} from "../dist/shared/pet-actions.js";

test("pet base actions represent actual work and sleep instead of semantic feedback", () => {
  assert.equal(basePetAction("processing"), "study");
  assert.equal(basePetAction("sleeping"), "sleep");
  assert.equal(basePetAction("overdue"), "idle");
  assert.equal(basePetAction("confused"), "idle");
  assert.equal(basePetAction("celebrating"), "idle");
});

test("text is eaten while files are read", () => {
  assert.equal(inputPetAction({ kind: "text", text: "明天交作业" }), "eat");
  assert.equal(inputPetAction({ kind: "files", files: [] }), "study");
});

test("only attention transitions wake the companion", () => {
  assert.equal(attentionPetAction("processing", "needs_clarification"), "wake");
  assert.equal(attentionPetAction("idle", "deadline_near"), "wake");
  assert.equal(attentionPetAction("deadline_near", "overdue"), "wake");
  assert.equal(attentionPetAction("idle", "success"), undefined);
  assert.equal(attentionPetAction("overdue", "overdue"), undefined);
});

test("physical movement, sleep and temporary actions have deterministic animation priority", () => {
  assert.equal(resolvedPetAction({ moving: true, base: "study", active: "eat" }), "drag");
  assert.equal(resolvedPetAction({ moving: false, base: "sleep", active: "pet" }), "sleep");
  assert.equal(resolvedPetAction({ moving: false, base: "sleep", active: "wake" }), "wake");
  assert.equal(resolvedPetAction({ moving: false, base: "study", active: "eat" }), "eat");
  assert.equal(resolvedPetAction({ moving: false, base: "study", active: "pet" }), "pet");
  assert.equal(resolvedPetAction({ moving: false, base: "study" }), "study");
});

test("interactive and landing animations finish while persistent poses remain", () => {
  for (const action of ["cling", "walk", "wake", "eat", "pet", "play", "cat"]) assert.equal(isOneShotPetAction(action), true);
  for (const action of ["idle", "drag", "study", "sleep"]) assert.equal(isOneShotPetAction(action), false);
});

test("temporary actions finish in order and reveal the current base action", () => {
  let motion = { active: undefined, queue: [] };
  motion = petMotionReducer(motion, { type: "command", command: { action: "pet", mode: "replace", requestedAt: "now" } });
  motion = petMotionReducer(motion, { type: "command", command: { action: "wake", mode: "enqueue", requestedAt: "now" } });
  assert.deepEqual(motion, { active: "pet", queue: ["wake"] });
  assert.equal(resolvedPetAction({ moving: false, base: "study", active: motion.active }), "pet");

  motion = petMotionReducer(motion, { type: "finished", action: "pet" });
  assert.deepEqual(motion, { active: "wake", queue: [] });
  motion = petMotionReducer(motion, { type: "finished", action: "wake" });
  assert.deepEqual(motion, { active: undefined, queue: [] });
  assert.equal(resolvedPetAction({ moving: false, base: "study", active: motion.active }), "study");
});

test("drag release landing is temporary instead of becoming a permanent resting pose", () => {
  let motion = petMotionReducer(
    { active: "eat", queue: ["wake"] },
    { type: "command", command: { action: "idle", mode: "replace", requestedAt: "now" } },
  );
  assert.deepEqual(motion, { active: undefined, queue: [] });

  motion = petMotionReducer(motion, {
    type: "command",
    command: { action: "cling", mode: "replace", requestedAt: "now" },
  });
  assert.equal(resolvedPetAction({ moving: false, base: "idle", active: motion.active }), "cling");
  motion = petMotionReducer(motion, { type: "finished", action: "cling" });
  assert.deepEqual(motion, { active: undefined, queue: [] });
  assert.equal(resolvedPetAction({ moving: false, base: "idle", active: motion.active }), "idle");
});

test("stale completion events and duplicate queue commands cannot corrupt the current action", () => {
  const initial = { active: "pet", queue: ["wake"] };
  assert.deepEqual(petMotionReducer(initial, { type: "finished", action: "walk" }), initial);
  assert.deepEqual(
    petMotionReducer(initial, { type: "command", command: { action: "wake", mode: "enqueue", requestedAt: "later" } }),
    initial,
  );
  assert.deepEqual(
    petMotionReducer(initial, { type: "command", command: { action: "idle", mode: "enqueue", requestedAt: "later" } }),
    initial,
  );
});

test("sleep remains at its final pose until an explicit wake replaces it", () => {
  let motion = { active: "sleep", queue: [] };
  motion = petMotionReducer(motion, { type: "finished", action: "sleep" });
  assert.deepEqual(motion, { active: "sleep", queue: [] });
  motion = petMotionReducer(motion, {
    type: "command",
    command: { action: "wake", mode: "replace", requestedAt: "now" },
  });
  assert.deepEqual(motion, { active: "wake", queue: [] });
});
