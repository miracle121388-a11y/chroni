export type WindowPosition = {
  x: number;
  y: number;
};

export type WindowSize = {
  width: number;
  height: number;
};

export type WindowBounds = WindowPosition & WindowSize;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
