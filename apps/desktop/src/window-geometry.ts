export type WindowPosition = {
  x: number;
  y: number;
};

export type WindowSize = {
  width: number;
  height: number;
};

export type WindowBounds = WindowPosition & WindowSize;

export type NormalizedWindowPlacement = {
  displayId: number;
  xRatio: number;
  yRatio: number;
};

export function hasCrossedDragThreshold(start: WindowPosition, cursor: WindowPosition, threshold = 6): boolean {
  return Math.hypot(cursor.x - start.x, cursor.y - start.y) >= threshold;
}

export function draggedWindowPosition(startWindow: WindowPosition, startCursor: WindowPosition, cursor: WindowPosition): WindowPosition {
  return {
    x: startWindow.x + cursor.x - startCursor.x,
    y: startWindow.y + cursor.y - startCursor.y,
  };
}

export function draggedWindowPositionWithinArea(
  startWindow: WindowPosition,
  startCursor: WindowPosition,
  cursor: WindowPosition,
  size: WindowSize,
  area: WindowBounds,
  margin = 12,
): WindowPosition {
  const position = draggedWindowPosition(startWindow, startCursor, cursor);
  return {
    x: Math.round(clamp(position.x, area.x + margin, Math.max(area.x + margin, area.x + area.width - size.width - margin))),
    y: Math.round(clamp(position.y, area.y + margin, Math.max(area.y + margin, area.y + area.height - size.height - margin))),
  };
}

export function schedulePopoverPosition(area: WindowBounds, anchor: WindowBounds | undefined, size: WindowSize, gap = 14, margin = 12): WindowPosition {
  const minX = area.x + margin;
  const maxX = Math.max(minX, area.x + area.width - size.width - margin);
  const minY = area.y + margin;
  const maxY = Math.max(minY, area.y + area.height - size.height - margin);
  if (!anchor) {
    return { x: maxX, y: clamp(area.y + 72, minY, maxY) };
  }

  const left = anchor.x - size.width - gap;
  const right = anchor.x + anchor.width + gap;
  const x = left >= minX ? left : right <= maxX ? right : clamp(left, minX, maxX);
  return {
    x: Math.round(x),
    y: Math.round(clamp(anchor.y + (anchor.height - size.height) / 2, minY, maxY)),
  };
}

export function snappedWindowPosition(bounds: WindowBounds, area: WindowBounds, threshold: number): WindowPosition {
  let x = bounds.x;
  let y = bounds.y;
  if (Math.abs(bounds.x - area.x) < threshold) x = area.x;
  if (Math.abs(bounds.y - area.y) < threshold) y = area.y;
  if (Math.abs(bounds.x + bounds.width - (area.x + area.width)) < threshold) x = area.x + area.width - bounds.width;
  if (Math.abs(bounds.y + bounds.height - (area.y + area.height)) < threshold) y = area.y + area.height - bounds.height;
  return {
    x: clamp(x, area.x, Math.max(area.x, area.x + area.width - bounds.width)),
    y: clamp(y, area.y, Math.max(area.y, area.y + area.height - bounds.height)),
  };
}

export function normalizedWindowPlacement(bounds: WindowBounds, area: WindowBounds, displayId: number): NormalizedWindowPlacement {
  const movableWidth = Math.max(0, area.width - bounds.width);
  const movableHeight = Math.max(0, area.height - bounds.height);
  return {
    displayId,
    xRatio: movableWidth ? clamp((bounds.x - area.x) / movableWidth, 0, 1) : 0,
    yRatio: movableHeight ? clamp((bounds.y - area.y) / movableHeight, 0, 1) : 0,
  };
}

export function restoredWindowPosition(
  placement: NormalizedWindowPlacement,
  area: WindowBounds,
  size: WindowSize,
): WindowPosition {
  const movableWidth = Math.max(0, area.width - size.width);
  const movableHeight = Math.max(0, area.height - size.height);
  return {
    x: Math.round(area.x + movableWidth * clamp(placement.xRatio, 0, 1)),
    y: Math.round(area.y + movableHeight * clamp(placement.yRatio, 0, 1)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
