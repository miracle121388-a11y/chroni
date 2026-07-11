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

const windowsDrawerHandleWidth = 34;
const windowsDrawerMargin = 8;

export function draggedWindowPosition(startWindow: WindowPosition, startCursor: WindowPosition, cursor: WindowPosition): WindowPosition {
  return {
    x: startWindow.x + cursor.x - startCursor.x,
    y: startWindow.y + cursor.y - startCursor.y,
  };
}

export function windowsDrawerPosition(area: WindowBounds, size: WindowSize, expanded: boolean): WindowPosition {
  return {
    x: area.x + area.width - (expanded ? size.width + windowsDrawerMargin : windowsDrawerHandleWidth),
    y: area.y + Math.round((area.height - size.height) / 2),
  };
}

export function interpolatedPosition(start: WindowPosition, target: WindowPosition, progress: number): WindowPosition {
  return {
    x: start.x + (target.x - start.x) * progress,
    y: start.y + (target.y - start.y) * progress,
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
