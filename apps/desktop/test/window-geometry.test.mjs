import assert from "node:assert/strict";
import test from "node:test";

import {
  draggedWindowPosition,
  interpolatedPosition,
  normalizedWindowPlacement,
  restoredWindowPosition,
  snappedWindowPosition,
  windowsDrawerPosition,
} from "../dist/window-geometry.js";

test("draggedWindowPosition measures every move from the immutable drag origin", () => {
  const startWindow = { x: 120, y: 240 };
  const startCursor = { x: 900, y: 600 };

  assert.deepEqual(draggedWindowPosition(startWindow, startCursor, { x: 930, y: 650 }), { x: 150, y: 290 });
  assert.deepEqual(draggedWindowPosition(startWindow, startCursor, { x: 880, y: 570 }), { x: 100, y: 210 });
  assert.deepEqual(startWindow, { x: 120, y: 240 });
  assert.deepEqual(startCursor, { x: 900, y: 600 });
});

test("windowsDrawerPosition keeps drawer targets inside an offset display", () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1040 };
  const size = { width: 384, height: 520 };

  assert.deepEqual(windowsDrawerPosition(area, size, true), { x: -392, y: 340 });
  assert.deepEqual(windowsDrawerPosition(area, size, false), { x: -34, y: 340 });
});

test("interpolatedPosition returns the linear position for progress", () => {
  const start = { x: -100, y: 60 };
  const target = { x: 300, y: 260 };

  assert.deepEqual(interpolatedPosition(start, target, 0), start);
  assert.deepEqual(interpolatedPosition(start, target, 0.25), { x: 0, y: 110 });
  assert.deepEqual(interpolatedPosition(start, target, 1), target);
});

test("snappedWindowPosition snaps nearby edges and clamps windows inside the work area", () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1040 };
  const size = { width: 180, height: 210 };

  assert.deepEqual(snappedWindowPosition({ ...size, x: -1900, y: 95 }, area, 36), { x: -1920, y: 80 });
  assert.deepEqual(snappedWindowPosition({ ...size, x: -210, y: 885 }, area, 36), { x: -180, y: 910 });
  assert.deepEqual(snappedWindowPosition({ ...size, x: -2500, y: 1300 }, area, 36), { x: -1920, y: 910 });
});

test("normalizedWindowPlacement records a display-relative movable position", () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1040 };
  const bounds = { x: -1050, y: 495, width: 180, height: 210 };

  assert.deepEqual(normalizedWindowPlacement(bounds, area, 42), {
    displayId: 42,
    xRatio: 0.5,
    yRatio: 0.5,
  });
});

test("restoredWindowPosition adapts normalized placement and clamps invalid ratios", () => {
  const area = { x: 200, y: 40, width: 1600, height: 900 };
  const size = { width: 180, height: 210 };

  assert.deepEqual(restoredWindowPosition({ displayId: 7, xRatio: 0.5, yRatio: 0.5 }, area, size), { x: 910, y: 385 });
  assert.deepEqual(restoredWindowPosition({ displayId: 7, xRatio: 4, yRatio: -2 }, area, size), { x: 1620, y: 40 });
});
