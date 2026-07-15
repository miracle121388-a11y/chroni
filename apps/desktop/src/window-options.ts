import type { BrowserWindowConstructorOptions } from "electron";

export const controlPreferredSize = { width: 980, height: 680 } as const;
export const controlMinimumSize = { width: 600, height: 360 } as const;

export function controlCenterWindowOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  return {
    ...controlPreferredSize,
    useContentSize: true,
    frame: true,
    resizable: true,
    show: false,
    title: "Chroni 控制中心",
    backgroundColor: "#f6f4ef",
    ...(platform === "win32" ? { autoHideMenuBar: true } : {}),
  };
}

export function configureControlWindowChrome(win: { removeMenu(): void }, platform: NodeJS.Platform): void {
  if (platform === "win32") win.removeMenu();
}
