import assert from "node:assert/strict";
import test from "node:test";

import { layoutTimelineIntervals } from "../dist/shared/daily-layout.js";

test("adjacent timeline tasks share one lane without being treated as overlapping", () => {
  const placements = layoutTimelineIntervals([
    { id: "short", startMinutes: 9 * 60, endMinutes: 9 * 60 + 30 },
    { id: "long", startMinutes: 9 * 60 + 30, endMinutes: 11 * 60 },
    { id: "next", startMinutes: 11 * 60, endMinutes: 12 * 60 + 30 },
  ]);

  assert.deepEqual(placements.map(({ id, lane, laneCount, group }) => ({ id, lane, laneCount, group })), [
    { id: "short", lane: 0, laneCount: 1, group: 0 },
    { id: "long", lane: 0, laneCount: 1, group: 1 },
    { id: "next", lane: 0, laneCount: 1, group: 2 },
  ]);
});

test("simultaneous timeline tasks receive stable left and right lanes", () => {
  const placements = layoutTimelineIntervals([
    { id: "later", startMinutes: 9 * 60 + 30, endMinutes: 11 * 60 },
    { id: "left", startMinutes: 9 * 60, endMinutes: 10 * 60 },
    { id: "right", startMinutes: 9 * 60, endMinutes: 10 * 60 + 30 },
  ]);

  assert.deepEqual(placements.map(({ id, lane, laneCount, group }) => ({ id, lane, laneCount, group })), [
    { id: "right", lane: 0, laneCount: 3, group: 0 },
    { id: "left", lane: 1, laneCount: 3, group: 0 },
    { id: "later", lane: 2, laneCount: 3, group: 0 },
  ]);
});

test("a released lane is reused inside a connected overlap group", () => {
  const placements = layoutTimelineIntervals([
    { id: "anchor", startMinutes: 9 * 60, endMinutes: 12 * 60 },
    { id: "first", startMinutes: 9 * 60, endMinutes: 10 * 60 },
    { id: "second", startMinutes: 10 * 60, endMinutes: 11 * 60 },
  ]);

  assert.equal(placements.find((item) => item.id === "first")?.lane, 1);
  assert.equal(placements.find((item) => item.id === "second")?.lane, 1);
  assert.ok(placements.every((item) => item.laneCount === 2));
});
