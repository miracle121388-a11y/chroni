import { BrowserWindow, Menu, Tray, app, autoUpdater, ipcMain, nativeImage, screen, shell, type BrowserWindowConstructorOptions, type Display, type MenuItemConstructorOptions, type NativeImage } from "electron";
import { join } from "node:path";
import type { ChroniPreferences, ChroniView, PetAction, PetActionCommand, PetPlacement } from "./shared/types.js";
import { draggedWindowPosition, draggedWindowPositionWithinArea, fitWindowSizeToWorkArea, normalizedWindowPlacement, restoredWindowPosition, schedulePopoverPosition, snappedWindowPosition, type WindowPosition } from "./window-geometry.js";
import { configureControlWindowChrome, configureRendererZoom, controlCenterWindowOptions, controlMinimumSize, controlPreferredSize, rendererZoomFactor } from "./window-options.js";

type WindowSet = {
  pet?: BrowserWindow;
  schedule?: BrowserWindow;
  control?: BrowserWindow;
  tray?: Tray;
};

export type ControlCenterRoute = {
  tab?: "schedule" | "daily" | "agent" | "preferences" | "services" | "about";
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
let onCheckForUpdatesRequested: (() => void) | undefined;
let lastPetPlacement: PetPlacement | undefined;
let lastSchedulePlacement: PetPlacement | undefined;
let onPetPlacementChanged: ((placement: PetPlacement) => void) | undefined;
let controlReadyWindow: BrowserWindow | undefined;
let controlFitTimer: NodeJS.Timeout | undefined;
let appQuitting = false;

const schedulePopoverWidth = 348;
const schedulePopoverHeight = 418;
const schedulePopoverPreferredSize = { width: schedulePopoverWidth, height: schedulePopoverHeight } as const;
const petSleepAnimationMs = 2_850;

export function createAppWindows(options: { petPlacement?: PetPlacement; onPetPlacementChanged?: (placement: PetPlacement) => void } = {}): void {
  appQuitting = false;
  const markAppQuitting = () => { appQuitting = true; };
  app.once("before-quit", markAppQuitting);
  autoUpdater.once("before-quit-for-update", markAppQuitting);
  lastPetPlacement = options.petPlacement;
  onPetPlacementChanged = options.onPetPlacementChanged;
  createPetWindow();
  screen.on("display-added", repositionWindowsForDisplays);
  screen.on("display-removed", repositionWindowsForDisplays);
  screen.on("display-metrics-changed", repositionWindowsForDisplays);

  windows.schedule = createScheduleWindow();
  positionScheduleWindow();

  ipcMain.on("chroni:start-window-drag", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const kind = win === windows.pet ? "pet" : win === windows.schedule && process.platform === "win32" ? "schedule" : undefined;
    if (!win || !kind) {
      event.returnValue = false;
      return;
    }
    const [x, y] = win.getPosition();
    const cursor = screen.getCursorScreenPoint();
    windowDragSessions.set(event.sender.id, {
      kind,
      startWindow: { x, y },
      startCursor: cursor,
    });
    if (kind === "pet" && windows.schedule?.isVisible()) hideSchedule();
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
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const size = fitWindowSizeToWorkArea(schedulePopoverPreferredSize, area, undefined, 12);
      const position = draggedWindowPositionWithinArea(
        session.startWindow,
        session.startCursor,
        cursor,
        size,
        area,
      );
      win.setBounds({ ...position, ...size }, false);
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
      lastSchedulePlacement = undefined;
      positionScheduleWindow();
    } else if (win && session.kind === "schedule") {
      persistSchedulePlacement(win);
    }
  });
}

export function createTray(options: { onCompanionVisibilityRequested?: (visible: boolean) => void; onCheckForUpdatesRequested?: () => void } = {}): void {
  onCompanionVisibilityRequested = options.onCompanionVisibilityRequested;
  onCheckForUpdatesRequested = options.onCheckForUpdatesRequested;
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
  if (appQuitting) return;
  let created = false;
  if (!windows.control || windows.control.isDestroyed()) {
    let control!: BrowserWindow;
    control = createViewWindow("control", controlCenterWindowOptions(process.platform), () => {
      if (windows.control === control) windows.control = undefined;
      if (controlReadyWindow === control) controlReadyWindow = undefined;
    });
    windows.control = control;
    controlReadyWindow = undefined;
    created = true;
    configureControlWindowChrome(control, process.platform);
    fitControlWindowToDisplay(control, {
      display: screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      initial: true,
    });
    control.once("ready-to-show", () => {
      if (windows.control !== control || control.isDestroyed()) return;
      controlReadyWindow = control;
      control.show();
      control.focus();
    });
    control.on("move", () => queueControlWindowFit(control));
    control.on("unmaximize", () => queueControlWindowFit(control));
    control.on("leave-full-screen", () => queueControlWindowFit(control));
    control.on("closed", () => {
      if (windows.control === control) {
        windows.control = undefined;
        if (controlReadyWindow === control) controlReadyWindow = undefined;
      }
    });
  }
  const control = windows.control;
  if (!control) return;
  if (!created && controlReadyWindow === control) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
  }
  if (route) {
    if (control.webContents.isLoading()) {
      control.webContents.once("did-finish-load", () => sendControlRoute(route));
    } else {
      sendControlRoute(route);
    }
  }
}

function fitControlWindowToDisplay(
  win: BrowserWindow,
  options: { display?: Display; initial?: boolean } = {},
): void {
  if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return;
  const display = options.display ?? screen.getDisplayMatching(win.getBounds());
  const outer = win.getBounds();
  const content = win.getContentBounds();
  const frame = {
    width: Math.max(0, outer.width - content.width),
    height: Math.max(0, outer.height - content.height),
  };
  const requestedSize = options.initial
    ? controlPreferredSize
    : { width: content.width, height: content.height };
  const contentSize = fitWindowSizeToWorkArea(requestedSize, display.workArea, frame);
  win.setMinimumSize(
    Math.max(1, Math.min(controlMinimumSize.width + frame.width, display.workArea.width)),
    Math.max(1, Math.min(controlMinimumSize.height + frame.height, display.workArea.height)),
  );
  if (options.initial || contentSize.width !== content.width || contentSize.height !== content.height) {
    win.setContentSize(contentSize.width, contentSize.height, false);
  }
  const bounds = win.getBounds();
  const position = options.initial
    ? {
        x: Math.round(display.workArea.x + (display.workArea.width - bounds.width) / 2),
        y: Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2),
      }
    : snappedWindowPosition(bounds, display.workArea, 0);
  if (position.x !== bounds.x || position.y !== bounds.y) {
    win.setPosition(Math.round(position.x), Math.round(position.y), false);
  }
}

function queueControlWindowFit(win: BrowserWindow): void {
  if (controlFitTimer) clearTimeout(controlFitTimer);
  controlFitTimer = setTimeout(() => {
    controlFitTimer = undefined;
    if (windows.control === win && !win.isDestroyed()) fitControlWindowToDisplay(win);
  }, 160);
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
  const schedule = ensureScheduleWindow();
  if (!schedule) return;
  positionScheduleWindow();
  if (scheduleHideTimer) clearTimeout(scheduleHideTimer);
  scheduleHideTimer = undefined;
  if (schedule.isMinimized()) schedule.restore();
  if (focus) {
    schedule.show();
    schedule.focus();
  } else {
    schedule.showInactive();
  }
}

export function hideSchedule(): void {
  const schedule = windows.schedule;
  if (schedule && !schedule.isDestroyed()) schedule.hide();
}

export function toggleScheduleSurface(): void {
  if (windows.schedule && !windows.schedule.isDestroyed() && windows.schedule.isVisible()) {
    hideSchedule();
  } else {
    showSchedule(true, true);
  }
}

export function applyPreferences(preferences: ChroniPreferences): void {
  const companionNeedsPet = preferences.companionEnabled && (!windows.pet || windows.pet.isDestroyed());
  if (lastAppliedCompanionEnabled === preferences.companionEnabled && !companionNeedsPet) return;
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
  const pet = ensurePetWindow();
  if (!pet) return;
  pet.showInactive();
  if (animate) requestPetAction("wake", "replace");
}

export function hidePet(animate = true): void {
  const generation = ++petVisibilityGeneration;
  const pet = windows.pet;
  if (!pet || pet.isDestroyed()) return;
  if (!animate || !pet.isVisible()) {
    pet.hide();
    return;
  }
  requestPetAction("sleep", "replace");
  setTimeout(() => {
    if (generation === petVisibilityGeneration && windows.pet === pet && !pet.isDestroyed()) pet.hide();
  }, petSleepAnimationMs);
}

function quitChroni(): void {
  if (quitAfterSleep) return;
  const pet = windows.pet;
  if (!pet || pet.isDestroyed() || !pet.isVisible()) {
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
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: process.platform === "win32",
    show: false,
  };
}

function createPetWindow(): BrowserWindow {
  let pet!: BrowserWindow;
  pet = createViewWindow("pet", {
    width: 180,
    height: 210,
    transparent: true,
    frame: false,
    hasShadow: false,
    ...(process.platform === "win32" ? { focusable: false } : {}),
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  }, () => {
    if (windows.pet === pet) windows.pet = undefined;
  });
  windows.pet = pet;
  restorePetPosition();
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const webContentsId = pet.webContents.id;
  pet.webContents.once("destroyed", () => windowDragSessions.delete(webContentsId));
  pet.on("closed", () => {
    if (windows.pet === pet) windows.pet = undefined;
  });
  return pet;
}

function ensurePetWindow(): BrowserWindow | undefined {
  if (appQuitting) return undefined;
  if (windows.pet && !windows.pet.isDestroyed()) return windows.pet;
  return createPetWindow();
}

function createScheduleWindow(): BrowserWindow {
  let schedule!: BrowserWindow;
  schedule = createViewWindow("schedule", scheduleWindowOptions(), () => {
    if (windows.schedule === schedule) windows.schedule = undefined;
  });
  windows.schedule = schedule;
  // The pet itself is visible in macOS full-screen Spaces, so its popover must
  // follow it there as well. Keep the existing Windows window policy intact.
  if (process.platform === "darwin") {
    schedule.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  const webContentsId = schedule.webContents.id;
  schedule.webContents.once("destroyed", () => windowDragSessions.delete(webContentsId));
  schedule.on("blur", () => {
    scheduleHideTimer = setTimeout(() => hideSchedule(), 160);
  });
  schedule.on("focus", () => {
    if (scheduleHideTimer) clearTimeout(scheduleHideTimer);
    scheduleHideTimer = undefined;
  });
  schedule.on("close", (event) => {
    if (appQuitting) return;
    event.preventDefault();
    schedule.hide();
  });
  schedule.on("closed", () => {
    if (windows.schedule === schedule) windows.schedule = undefined;
  });
  return schedule;
}

function ensureScheduleWindow(): BrowserWindow | undefined {
  if (appQuitting) return undefined;
  if (windows.schedule && !windows.schedule.isDestroyed()) return windows.schedule;
  const schedule = createScheduleWindow();
  positionScheduleWindow();
  return schedule;
}

function createViewWindow(
  view: ChroniView,
  options: BrowserWindowConstructorOptions,
  onLoadFailed?: (error: unknown) => void,
): BrowserWindow {
  const icon = windowsAppIconPath();
  const win = new BrowserWindow({
    backgroundColor: "#00000000",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(app.getAppPath(), "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: rendererZoomFactor,
    },
    ...options,
  });
  configureRendererZoom(win.webContents);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
  });
  void loadView(win, view).catch((error: unknown) => {
    console.error(`Failed to load Chroni ${view} view.`, error);
    onLoadFailed?.(error);
    if (!win.isDestroyed()) win.destroy();
  });
  return win;
}

function windowsAppIconPath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  return app.isPackaged
    ? join(process.resourcesPath, "icon.ico")
    : join(app.getAppPath(), "build", "icon.ico");
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
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
  if (!win || win.isDestroyed()) return;
  const petBounds = windows.pet && !windows.pet.isDestroyed() ? windows.pet.getBounds() : undefined;
  const display = lastSchedulePlacement
    ? screen.getAllDisplays().find((candidate) => candidate.id === lastSchedulePlacement?.displayId)
      ?? (petBounds ? screen.getDisplayMatching(petBounds) : screen.getPrimaryDisplay())
    : petBounds
      ? screen.getDisplayMatching(petBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = fitWindowSizeToWorkArea(schedulePopoverPreferredSize, display.workArea, undefined, 12);
  const currentBounds = win.getBounds();
  if (currentBounds.width !== size.width || currentBounds.height !== size.height) {
    win.setSize(size.width, size.height, false);
  }
  if (lastSchedulePlacement) {
    const position = restoredWindowPosition(lastSchedulePlacement, display.workArea, win.getBounds());
    win.setPosition(position.x, position.y);
    return;
  }
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

function repositionWindowsForDisplays(): void {
  if (windows.pet && !windows.pet.isDestroyed()) restorePetPosition();
  if (windows.schedule && !windows.schedule.isDestroyed()) positionScheduleWindow();
  if (windows.control && !windows.control.isDestroyed()) fitControlWindowToDisplay(windows.control);
}

function persistSchedulePlacement(win: BrowserWindow): void {
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
  const windowsIconPath = windowsAppIconPath();
  if (windowsIconPath) {
    const windowsIcon = nativeImage.createFromPath(windowsIconPath);
    if (!windowsIcon.isEmpty()) return windowsIcon;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#243b53"/><path d="M8 17h9l-2 7 9-11h-9l2-6z" fill="#f8d66d"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function appMenuTemplate(): MenuItemConstructorOptions[] {
  return [
    { label: "查看日程", click: () => showSchedule(true, true) },
    { label: "打开控制中心", click: () => showControlCenter() },
    { label: "关于 Chroni", click: () => showControlCenter({ tab: "about" }) },
    { label: "检查更新", click: () => onCheckForUpdatesRequested?.() },
    { type: "separator" },
    { label: "显示桌宠", click: () => { if (onCompanionVisibilityRequested) onCompanionVisibilityRequested(true); else showPet(true); } },
    { label: "隐藏桌宠", click: () => { if (onCompanionVisibilityRequested) onCompanionVisibilityRequested(false); else hidePet(true); } },
    { label: "隐藏日程表", click: () => hideSchedule() },
    { type: "separator" },
    { label: `Chroni v${app.getVersion()}`, enabled: false },
    { label: "退出 Chroni", click: () => quitChroni() },
  ];
}
