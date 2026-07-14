import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type NativeImage } from "electron";
import { join } from "node:path";
import type { ChroniPreferences, ChroniView, PetAction, PetActionCommand, PetPlacement } from "./shared/types.js";
import { draggedWindowPosition, draggedWindowPositionWithinArea, normalizedWindowPlacement, restoredWindowPosition, schedulePopoverPosition, snappedWindowPosition, type WindowPosition } from "./window-geometry.js";

type WindowSet = {
  pet?: BrowserWindow;
  schedule?: BrowserWindow;
  control?: BrowserWindow;
  tray?: Tray;
};

export type ControlCenterRoute = {
  tab?: "schedule" | "daily" | "agent" | "preferences" | "services";
  taskId?: string;
  focus?: "clarifications";
};

const windows: WindowSet = {};
let scheduleHideTimer: NodeJS.Timeout | undefined;
const windowDragSessions = new Map<number, { kind: "pet" | "schedule"; startWindow: WindowPosition; startCursor: WindowPosition }>();
let petVisibilityGeneration = 0;
let lastAppliedCompanionEnabled: boolean | undefined;
let quitAfterSleep = false;
let onCompanionVisibilityRequested: ((visible: boolean) => void) | undefined;
let lastPetPlacement: PetPlacement | undefined;
let lastSchedulePlacement: PetPlacement | undefined;
let onPetPlacementChanged: ((placement: PetPlacement) => void) | undefined;

const schedulePopoverWidth = 348;
const schedulePopoverHeight = 418;
const petSleepAnimationMs = 2_850;

export function createAppWindows(options: { petPlacement?: PetPlacement; onPetPlacementChanged?: (placement: PetPlacement) => void } = {}): void {
  lastPetPlacement = options.petPlacement;
  onPetPlacementChanged = options.onPetPlacementChanged;
  windows.pet = createViewWindow("pet", {
    width: 180,
    height: 210,
    transparent: true,
    frame: false,
    ...(process.platform === "darwin" ? { hasShadow: false } : {}),
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });
  restorePetPosition();
  windows.pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const petWebContentsId = windows.pet.webContents.id;
  windows.pet.webContents.once("destroyed", () => windowDragSessions.delete(petWebContentsId));
  screen.on("display-removed", repositionPetForDisplays);
  screen.on("display-metrics-changed", repositionPetForDisplays);

  windows.schedule = createViewWindow("schedule", scheduleWindowOptions());
  // The pet itself is visible in macOS full-screen Spaces, so its popover must
  // follow it there as well. Keep the existing Windows window policy intact.
  if (process.platform === "darwin") {
    windows.schedule.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  positionScheduleWindow();
  const scheduleWebContentsId = windows.schedule.webContents.id;
  windows.schedule.webContents.once("destroyed", () => windowDragSessions.delete(scheduleWebContentsId));
  windows.schedule.on("blur", () => {
    scheduleHideTimer = setTimeout(() => hideSchedule(), 160);
  });
  windows.schedule.on("focus", () => {
    if (scheduleHideTimer) clearTimeout(scheduleHideTimer);
    scheduleHideTimer = undefined;
  });

  ipcMain.on("chroni:start-window-drag", (event, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const kind = win === windows.pet ? "pet" : win === windows.schedule && process.platform === "win32" ? "schedule" : undefined;
    if (!win || !kind || !Number.isFinite(screenX) || !Number.isFinite(screenY)) {
      event.returnValue = false;
      return;
    }
    const [x, y] = win.getPosition();
    windowDragSessions.set(event.sender.id, {
      kind,
      startWindow: { x, y },
      startCursor: { x: screenX, y: screenY },
    });
    event.returnValue = true;
  });
  ipcMain.on("chroni:move-window-drag", (event) => {
    const session = windowDragSessions.get(event.sender.id);
    if (!session) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    const expectedWindow = session.kind === "pet" ? windows.pet : windows.schedule;
    if (!win || win !== expectedWindow) {
      windowDragSessions.delete(event.sender.id);
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    if (session.kind === "schedule") {
      const position = draggedWindowPositionWithinArea(
        session.startWindow,
        session.startCursor,
        cursor,
        { width: schedulePopoverWidth, height: schedulePopoverHeight },
        screen.getDisplayNearestPoint(cursor).workArea,
      );
      win.setBounds({ ...position, width: schedulePopoverWidth, height: schedulePopoverHeight }, false);
    } else {
      const position = draggedWindowPosition(session.startWindow, session.startCursor, cursor);
      win.setPosition(Math.round(position.x), Math.round(position.y));
    }
  });
  ipcMain.on("chroni:end-window-drag", (event) => {
    const session = windowDragSessions.get(event.sender.id);
    if (!session) return;
    windowDragSessions.delete(event.sender.id);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && session.kind === "pet") {
      snapWindowToEdge(win);
      persistPetPlacement(win);
    } else if (win && session.kind === "schedule") {
      persistSchedulePlacement(win);
    }
  });
}

export function createTray(options: { onCompanionVisibilityRequested?: (visible: boolean) => void } = {}): void {
  onCompanionVisibilityRequested = options.onCompanionVisibilityRequested;
  windows.tray = new Tray(createTrayIcon());
  const menu = Menu.buildFromTemplate(appMenuTemplate());
  windows.tray.setToolTip("Chroni");
  windows.tray.setContextMenu(menu);
  windows.tray.on("click", () => showControlCenter());
}

export function showPetMenu(source?: BrowserWindow | null): void {
  Menu.buildFromTemplate(appMenuTemplate()).popup({
    window: source ?? windows.pet,
  });
}

export function showControlCenter(route?: ControlCenterRoute): void {
  if (!windows.control || windows.control.isDestroyed()) {
    windows.control = createViewWindow("control", {
      width: 980,
      height: 680,
      minWidth: 760,
      minHeight: 520,
      frame: true,
      resizable: true,
      title: "Chroni 控制中心",
    });
    windows.control.on("closed", () => { windows.control = undefined; });
  }
  windows.control.show();
  windows.control.focus();
  if (route) {
    if (windows.control.webContents.isLoading()) {
      windows.control.webContents.once("did-finish-load", () => sendControlRoute(route));
    } else {
      sendControlRoute(route);
    }
  }
}

function sendControlRoute(route: ControlCenterRoute): void {
  if (!windows.control || windows.control.isDestroyed()) return;
  windows.control.webContents.send("chroni:control-navigate", route);
}

export function showSchedule(expanded = true, focus = false): void {
  if (!expanded) {
    hideSchedule();
    return;
  }
  positionScheduleWindow();
  if (scheduleHideTimer) clearTimeout(scheduleHideTimer);
  scheduleHideTimer = undefined;
  if (focus) {
    windows.schedule?.show();
    windows.schedule?.focus();
  } else {
    windows.schedule?.showInactive();
  }
}

export function hideSchedule(): void {
  windows.schedule?.hide();
}

export function toggleScheduleSurface(): void {
  if (windows.schedule?.isVisible()) {
    hideSchedule();
  } else {
    showSchedule(true, true);
  }
}

export function applyPreferences(preferences: ChroniPreferences): void {
  if (lastAppliedCompanionEnabled === preferences.companionEnabled) return;
  const initial = lastAppliedCompanionEnabled === undefined;
  lastAppliedCompanionEnabled = preferences.companionEnabled;
  if (preferences.companionEnabled) showPet(!initial);
  else hidePet(!initial);
}

export function requestPetAction(action: PetAction, mode: PetActionCommand["mode"] = "enqueue"): void {
  if (!windows.pet || windows.pet.isDestroyed()) return;
  const command: PetActionCommand = { action, mode, requestedAt: new Date().toISOString() };
  windows.pet.webContents.send("chroni:pet-action", command);
}

export function showPet(animate = true): void {
  petVisibilityGeneration += 1;
  windows.pet?.showInactive();
  if (animate) requestPetAction("wake", "replace");
}

export function hidePet(animate = true): void {
  const generation = ++petVisibilityGeneration;
  if (!animate || !windows.pet?.isVisible()) {
    windows.pet?.hide();
    return;
  }
  requestPetAction("sleep", "replace");
  setTimeout(() => {
    if (generation === petVisibilityGeneration) windows.pet?.hide();
  }, petSleepAnimationMs);
}

function quitChroni(): void {
  if (quitAfterSleep) return;
  if (!windows.pet?.isVisible()) {
    app.quit();
    return;
  }
  quitAfterSleep = true;
  requestPetAction("sleep", "replace");
  setTimeout(() => app.quit(), petSleepAnimationMs);
}

export function refreshScheduleAfterUpdate(): void {
  if (windows.schedule?.isVisible()) positionScheduleWindow();
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of [windows.pet, windows.schedule, windows.control]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function scheduleWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: schedulePopoverWidth,
    height: schedulePopoverHeight,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: process.platform === "win32",
    show: false,
  };
}

function createViewWindow(view: ChroniView, options: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    backgroundColor: "#00000000",
    webPreferences: {
      preload: join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    ...options,
  });
  void loadView(win, view);
  return win;
}

async function loadView(win: BrowserWindow, view: ChroniView): Promise<void> {
  const devUrl = process.env.CHRONI_RENDERER_URL;
  if (devUrl) {
    await win.loadURL(`${devUrl}?view=${view}`);
  } else {
    await win.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"), { query: { view } });
  }
}

function positionScheduleWindow(): void {
  const win = windows.schedule;
  if (!win) return;
  const currentBounds = win.getBounds();
  if (currentBounds.width !== schedulePopoverWidth || currentBounds.height !== schedulePopoverHeight) {
    win.setSize(schedulePopoverWidth, schedulePopoverHeight, false);
  }
  const petBounds = windows.pet && !windows.pet.isDestroyed() ? windows.pet.getBounds() : undefined;
  if (lastSchedulePlacement) {
    const display = screen.getAllDisplays().find((candidate) => candidate.id === lastSchedulePlacement?.displayId)
      ?? (petBounds ? screen.getDisplayMatching(petBounds) : screen.getPrimaryDisplay());
    const position = restoredWindowPosition(lastSchedulePlacement, display.workArea, win.getBounds());
    win.setPosition(position.x, position.y);
    return;
  }
  const display = petBounds
    ? screen.getDisplayMatching(petBounds)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = win.getBounds();
  const position = schedulePopoverPosition(display.workArea, petBounds, bounds);
  win.setPosition(position.x, position.y);
}

function snapWindowToEdge(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const position = snappedWindowPosition(bounds, display, 36);
  win.setPosition(Math.round(position.x), Math.round(position.y));
}

function restorePetPosition(): void {
  const win = windows.pet;
  if (!win) return;
  if (!lastPetPlacement) {
    const area = screen.getPrimaryDisplay().workArea;
    win.setPosition(area.x + area.width - 220, area.y + area.height - 280);
    persistPetPlacement(win);
    return;
  }
  const display = screen.getAllDisplays().find((candidate) => candidate.id === lastPetPlacement?.displayId)
    ?? screen.getPrimaryDisplay();
  const bounds = win.getBounds();
  const position = restoredWindowPosition(lastPetPlacement, display.workArea, bounds);
  win.setPosition(position.x, position.y);
  persistPetPlacement(win);
}

function repositionPetForDisplays(): void {
  if (!windows.pet || windows.pet.isDestroyed()) return;
  restorePetPosition();
  positionScheduleWindow();
}

function persistSchedulePlacement(win: BrowserWindow): void {
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width: schedulePopoverWidth, height: schedulePopoverHeight }, false);
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  lastSchedulePlacement = normalizedWindowPlacement(bounds, display.workArea, display.id);
}

function persistPetPlacement(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  lastPetPlacement = normalizedWindowPlacement(bounds, display.workArea, display.id);
  onPetPlacementChanged?.(lastPetPlacement);
}

function createTrayIcon(): NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#243b53"/><path d="M8 17h9l-2 7 9-11h-9l2-6z" fill="#f8d66d"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function appMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    { label: "查看日程", click: () => showSchedule(true, true) },
    { label: "打开控制中心", click: () => showControlCenter() },
    { type: "separator" },
    { label: "显示桌宠", click: () => { if (onCompanionVisibilityRequested) onCompanionVisibilityRequested(true); else showPet(true); } },
    { label: "隐藏桌宠", click: () => { if (onCompanionVisibilityRequested) onCompanionVisibilityRequested(false); else hidePet(true); } },
    { label: "隐藏日程表", click: () => hideSchedule() },
    { type: "separator" },
    { label: "退出 Chroni", click: () => quitChroni() },
  ];
}
