import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, type BrowserWindowConstructorOptions, type MenuItemConstructorOptions, type NativeImage } from "electron";
import { join } from "node:path";
import type { ChroniPreferences, ChroniView } from "./shared/types.js";

type WindowSet = {
  pet?: BrowserWindow;
  schedule?: BrowserWindow;
  control?: BrowserWindow;
  tray?: Tray;
};

const windows: WindowSet = {};
let scheduleExpanded = false;
let macScheduleHideTimer: NodeJS.Timeout | undefined;

const windowsDrawerWidth = 384;
const windowsDrawerHandleWidth = 34;
const windowsDrawerMargin = 8;
const macPopoverWidth = 348;
const macPopoverHeight = 418;

export function createAppWindows(): void {
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
  const display = screen.getPrimaryDisplay().workArea;
  windows.pet.setPosition(display.x + display.width - 220, display.y + display.height - 280);
  windows.pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  windows.schedule = createViewWindow("schedule", scheduleWindowOptions());
  positionScheduleWindow(false);
  if (process.platform === "darwin") {
    windows.schedule.on("blur", () => {
      macScheduleHideTimer = setTimeout(() => hideSchedule(), 160);
    });
    windows.schedule.on("focus", () => {
      if (macScheduleHideTimer) clearTimeout(macScheduleHideTimer);
      macScheduleHideTimer = undefined;
    });
  }

  ipcMain.on("chroni:drag-window", (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on("chroni:snap-window", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) snapWindowToEdge(win);
  });
}

export function createTray(): void {
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

export function showControlCenter(): void {
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
}

export function showSchedule(expanded = true, focus = false): void {
  scheduleExpanded = expanded;
  if (process.platform === "darwin" && !expanded) {
    hideSchedule();
    return;
  }
  positionScheduleWindow(expanded);
  if (process.platform === "darwin") {
    if (macScheduleHideTimer) clearTimeout(macScheduleHideTimer);
    macScheduleHideTimer = undefined;
    if (focus) {
      windows.schedule?.show();
      windows.schedule?.focus();
    } else {
      windows.schedule?.showInactive();
    }
    return;
  }
  windows.schedule?.showInactive();
}

export function hideSchedule(): void {
  if (process.platform === "win32") {
    scheduleExpanded = false;
    positionScheduleWindow(false);
    windows.schedule?.showInactive();
    return;
  }
  windows.schedule?.hide();
}

export function toggleScheduleSurface(): void {
  if (process.platform === "darwin") {
    if (windows.schedule?.isVisible()) {
      hideSchedule();
    } else {
      showSchedule(true, true);
    }
    return;
  }
  showSchedule(!scheduleExpanded);
}

export function applyPreferences(preferences: ChroniPreferences): void {
  if (preferences.companionEnabled) {
    if (!windows.pet?.isVisible()) windows.pet?.showInactive();
  } else {
    windows.pet?.hide();
  }
}

export function refreshScheduleAfterUpdate(): void {
  if (process.platform === "win32") {
    showSchedule(scheduleExpanded);
    return;
  }
  if (windows.schedule?.isVisible()) positionScheduleWindow(true);
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of [windows.pet, windows.schedule, windows.control]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function scheduleWindowOptions(): BrowserWindowConstructorOptions {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  return {
    width: isWindows ? windowsDrawerWidth : isMac ? macPopoverWidth : 380,
    height: isMac ? macPopoverHeight : 430,
    transparent: true,
    frame: false,
    ...(isMac ? { hasShadow: false } : {}),
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: isWindows,
    show: !isMac,
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

function positionScheduleWindow(expanded: boolean): void {
  const win = windows.schedule;
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  if (process.platform === "win32") {
    const width = win.getBounds().width;
    const height = Math.min(520, area.height - 48);
    if (win.getBounds().height !== height) win.setSize(width, height);
    const x = expanded
      ? area.x + area.width - width - windowsDrawerMargin
      : area.x + area.width - windowsDrawerHandleWidth;
    const y = area.y + Math.round((area.height - height) / 2);
    animateWindowTo(win, x, y);
  } else if (process.platform === "darwin") {
    const petBounds = windows.pet?.getBounds();
    const bounds = win.getBounds();
    const nearPetLeft = petBounds ? petBounds.x - bounds.width - 14 : Number.NaN;
    const nearPetRight = petBounds ? petBounds.x + petBounds.width + 14 : Number.NaN;
    const targetX = petBounds
      ? (nearPetLeft >= area.x + 12 ? nearPetLeft : nearPetRight)
      : area.x + area.width - bounds.width - 28;
    const targetY = petBounds ? petBounds.y + Math.round((petBounds.height - bounds.height) / 2) : area.y + 72;
    const x = Math.min(Math.max(targetX, area.x + 12), area.x + area.width - bounds.width - 12);
    const y = Math.min(Math.max(targetY, area.y + 12), area.y + area.height - bounds.height - 12);
    win.setPosition(Math.round(x), Math.round(y));
  } else {
    win.setPosition(area.x + area.width - win.getBounds().width - 28, area.y + 72);
  }
}

function animateWindowTo(win: BrowserWindow, targetX: number, targetY: number): void {
  const [startX, startY] = win.getPosition();
  const steps = 6;
  for (let step = 1; step <= steps; step += 1) {
    setTimeout(() => {
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      win.setPosition(
        Math.round(startX + (targetX - startX) * eased),
        Math.round(startY + (targetY - startY) * eased),
      );
    }, step * 12);
  }
}

function snapWindowToEdge(win: BrowserWindow): void {
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds).workArea;
  const threshold = 36;
  let x = bounds.x;
  let y = bounds.y;
  if (Math.abs(bounds.x - display.x) < threshold) x = display.x;
  if (Math.abs(bounds.y - display.y) < threshold) y = display.y;
  if (Math.abs(bounds.x + bounds.width - (display.x + display.width)) < threshold) x = display.x + display.width - bounds.width;
  if (Math.abs(bounds.y + bounds.height - (display.y + display.height)) < threshold) y = display.y + display.height - bounds.height;
  x = Math.min(Math.max(x, display.x), display.x + display.width - bounds.width);
  y = Math.min(Math.max(y, display.y), display.y + display.height - bounds.height);
  win.setPosition(Math.round(x), Math.round(y));
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
    { label: "显示桌宠", click: () => windows.pet?.showInactive() },
    { label: "隐藏桌宠", click: () => windows.pet?.hide() },
    { label: "隐藏日程表", click: () => hideSchedule() },
    { type: "separator" },
    { label: "退出 Chroni", click: () => app.quit() },
  ];
}
