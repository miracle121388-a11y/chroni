import { BrowserWindow, Menu, Tray, app, ipcMain, nativeImage, screen, type BrowserWindowConstructorOptions, type NativeImage } from "electron";
import { join } from "node:path";
import type { ChroniPreferences, ChroniView } from "./shared/types.js";

type WindowSet = {
  pet?: BrowserWindow;
  schedule?: BrowserWindow;
  control?: BrowserWindow;
  tray?: Tray;
};

const windows: WindowSet = {};

export function createAppWindows(): void {
  windows.pet = createViewWindow("pet", {
    width: 180,
    height: 210,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  });
  const display = screen.getPrimaryDisplay().workArea;
  windows.pet.setPosition(display.x + display.width - 220, display.y + display.height - 280);
  windows.pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  windows.schedule = createViewWindow("schedule", scheduleWindowOptions());
  positionScheduleWindow(false);

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
  const menu = Menu.buildFromTemplate([
    { label: "打开控制中心", click: () => showControlCenter() },
    { label: "显示桌宠", click: () => windows.pet?.show() },
    { label: "隐藏桌宠", click: () => windows.pet?.hide() },
    { label: "显示日程表", click: () => showSchedule(true) },
    { type: "separator" },
    { label: "退出 Chroni", click: () => app.quit() },
  ]);
  windows.tray.setToolTip("Chroni");
  windows.tray.setContextMenu(menu);
  windows.tray.on("click", () => showControlCenter());
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

export function showSchedule(expanded = true): void {
  positionScheduleWindow(expanded);
  windows.schedule?.showInactive();
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
    showSchedule(true);
    return;
  }
  positionScheduleWindow(true);
  if (!windows.schedule?.isVisible()) windows.schedule?.showInactive();
}

export function broadcast(channel: string, payload: unknown): void {
  for (const win of [windows.pet, windows.schedule, windows.control]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function scheduleWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: process.platform === "win32" ? 342 : 380,
    height: 430,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: process.platform === "win32",
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
    const x = expanded ? area.x + area.width - width - 10 : area.x + area.width - 24;
    win.setPosition(x, area.y + Math.round((area.height - win.getBounds().height) / 2));
  } else {
    win.setPosition(area.x + area.width - win.getBounds().width - 28, area.y + 72);
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
