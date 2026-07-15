import electronUpdater from "electron-updater";
import type { ChroniUpdateStatus } from "./shared/types.js";

type UpdateStatusListener = (status: ChroniUpdateStatus) => void;

type ChroniUpdaterOptions = {
  currentVersion: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  onStatus: UpdateStatusListener;
  onDownloaded?: (status: ChroniUpdateStatus) => void;
};

export class ChroniUpdater {
  #status: ChroniUpdateStatus;
  #started = false;
  #automaticCheckTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: ChroniUpdaterOptions) {
    this.#status = initialUpdateStatus(options.currentVersion, options.packaged, options.platform);
  }

  status(): ChroniUpdateStatus {
    return structuredClone(this.#status);
  }

  start(delayMs = 12_000): void {
    if (this.#started) return;
    this.#started = true;
    this.options.onStatus(this.status());
    if (this.#status.phase === "unsupported") return;

    const { autoUpdater } = electronUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = this.options.currentVersion.includes("-");
    autoUpdater.logger = console;

    autoUpdater.on("checking-for-update", () => this.#publish({
      phase: "checking",
      message: "正在检查新版本...",
    }));
    autoUpdater.on("update-available", (info) => this.#publish({
      phase: "available",
      availableVersion: info.version,
      message: `发现 Chroni ${info.version}，正在后台下载。`,
    }));
    autoUpdater.on("update-not-available", () => this.#publish({
      phase: "up-to-date",
      checkedAt: new Date().toISOString(),
      progressPercent: undefined,
      message: "当前已经是最新版本。",
    }));
    autoUpdater.on("download-progress", (progress) => this.#publish({
      phase: "downloading",
      progressPercent: clampPercent(progress.percent),
      message: `正在下载更新 ${Math.round(clampPercent(progress.percent))}%`,
    }));
    autoUpdater.on("update-downloaded", (info) => {
      this.#publish({
        phase: "downloaded",
        availableVersion: info.version,
        progressPercent: 100,
        checkedAt: new Date().toISOString(),
        message: `Chroni ${info.version} 已下载，重启后即可完成安装。`,
      });
      this.options.onDownloaded?.(this.status());
    });
    autoUpdater.on("error", (error) => this.#publish({
      phase: "error",
      checkedAt: new Date().toISOString(),
      progressPercent: undefined,
      message: updateErrorMessage(error),
    }));

    this.#automaticCheckTimer = setTimeout(() => {
      this.#automaticCheckTimer = undefined;
      void this.check().catch(() => undefined);
    }, Math.max(0, delayMs));
  }

  async check(): Promise<ChroniUpdateStatus> {
    if (this.#status.phase === "unsupported") return this.status();
    if (!this.#started) this.start();
    if (this.#automaticCheckTimer) clearTimeout(this.#automaticCheckTimer);
    this.#automaticCheckTimer = undefined;
    this.#publish({ phase: "checking", message: "正在检查新版本..." });
    try {
      await electronUpdater.autoUpdater.checkForUpdates();
    } catch (error) {
      this.#publish({
        phase: "error",
        checkedAt: new Date().toISOString(),
        progressPercent: undefined,
        message: updateErrorMessage(error),
      });
    }
    return this.status();
  }

  install(): ChroniUpdateStatus {
    if (this.#status.phase !== "downloaded") return this.status();
    setImmediate(() => electronUpdater.autoUpdater.quitAndInstall(false, true));
    return this.status();
  }

  dispose(): void {
    if (this.#automaticCheckTimer) clearTimeout(this.#automaticCheckTimer);
    this.#automaticCheckTimer = undefined;
  }

  #publish(patch: Partial<ChroniUpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.options.onStatus(this.status());
  }
}

export function initialUpdateStatus(currentVersion: string, packaged: boolean, platform: NodeJS.Platform): ChroniUpdateStatus {
  const supported = packaged && (platform === "win32" || platform === "darwin");
  return {
    currentVersion,
    phase: supported ? "idle" : "unsupported",
    message: supported
      ? "Chroni 会在后台检查 GitHub Releases 中的新版本。"
      : packaged
        ? "当前平台暂不支持应用内自动更新。"
        : "开发模式不会连接更新服务。",
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function updateErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (/net::|ENOTFOUND|ECONN|TIMED?OUT|network/i.test(detail)) return "暂时无法连接更新服务，请检查网络后重试。";
  if (/404|latest\.yml|latest-mac\.yml/i.test(detail)) return "当前发布通道还没有可用更新。";
  return "检查更新失败，请稍后重试或前往 GitHub Releases 手动下载。";
}
