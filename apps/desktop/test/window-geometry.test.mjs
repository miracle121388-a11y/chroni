import assert from "node:assert/strict";
import test from "node:test";

import {
  draggedWindowPosition,
  draggedWindowPositionWithinArea,
  fitWindowSizeToWorkArea,
  hasCrossedDragThreshold,
  normalizedWindowPlacement,
  restoredWindowPosition,
  schedulePopoverPosition,
  snappedWindowPosition,
} from "../dist/window-geometry.js";

test("window content sizes fit inside small high-DPI work areas", () => {
  assert.deepEqual(
    fitWindowSizeToWorkArea({ width: 980, height: 680 }, { width: 1_920, height: 1_040 }, { width: 16, height: 40 }),
    { width: 980, height: 680 },
  );
  assert.deepEqual(
    fitWindowSizeToWorkArea({ width: 980, height: 680 }, { width: 683, height: 344 }, { width: 16, height: 40 }),
    { width: 667, height: 304 },
  );
  assert.deepEqual(
    fitWindowSizeToWorkArea({ width: 348, height: 418 }, { width: 300, height: 500 }, { width: -20, height: -20 }, 12),
    { width: 276, height: 418 },
  );
});

test("drag intent uses the same stable threshold on every platform", () => {
  const start = { x: 500, y: 300 };
  assert.equal(hasCrossedDragThreshold(start, { x: 503, y: 304 }), false);
  assert.equal(hasCrossedDragThreshold(start, { x: 506, y: 300 }), true);
  assert.equal(hasCrossedDragThreshold(start, { x: 496, y: 296 }), false);
  assert.equal(hasCrossedDragThreshold(start, { x: 495, y: 296 }), true);
});

test("draggedWindowPosition measures every move from the immutable drag origin", () => {
  const startWindow = { x: 120, y: 240 };
  const startCursor = { x: 900, y: 600 };

  assert.deepEqual(draggedWindowPosition(startWindow, startCursor, { x: 930, y: 650 }), { x: 150, y: 290 });
  assert.deepEqual(draggedWindowPosition(startWindow, startCursor, { x: 880, y: 570 }), { x: 100, y: 210 });
  assert.deepEqual(startWindow, { x: 120, y: 240 });
  assert.deepEqual(startCursor, { x: 900, y: 600 });
});

test("schedule popover stays beside the pet and inside an offset display", () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1040 };
  const size = { width: 348, height: 418 };

  assert.deepEqual(
    schedulePopoverPosition(area, { x: -210, y: 875, width: 180, height: 210 }, size),
    { x: -572, y: 690 },
  );
  assert.deepEqual(
    schedulePopoverPosition(area, { x: -1900, y: 90, width: 180, height: 210 }, size),
    { x: -1706, y: 92 },
  );
});

test("schedule drag remains recoverable inside the active display", () => {
  const area = { x: -1920, y: 80, width: 1920, height: 1040 };
  const size = { width: 348, height: 418 };
  const start = { x: -572, y: 690 };
  const cursorStart = { x: 100, y: 100 };

  assert.deepEqual(
    draggedWindowPositionWithinArea(start, cursorStart, { x: 500, y: 1_400 }, size, area),
    { x: -360, y: 690 },
  );
  assert.deepEqual(
    draggedWindowPositionWithinArea(start, cursorStart, { x: -2_000, y: -100 }, size, area),
    { x: -1908, y: 490 },
  );
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
