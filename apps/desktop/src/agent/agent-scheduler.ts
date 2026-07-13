import type { AgentMemory, AgentRunResult, AgentRunTrigger } from "../shared/types.js";

export type AgentSchedulerOptions = {
  run(trigger: AgentRunTrigger): Promise<unknown>;
  getMemory(): Pick<AgentMemory, "automaticInspectionEnabled">;
  getLatestRun(): Pick<AgentRunResult, "trigger" | "completedAt"> | undefined;
  getLastAutomaticRunAt?(): string | undefined;
  now?: () => Date;
  debounceMs?: number;
};

export class AgentScheduler {
  readonly #run: AgentSchedulerOptions["run"];
  readonly #getMemory: AgentSchedulerOptions["getMemory"];
  readonly #getLatestRun: AgentSchedulerOptions["getLatestRun"];
  readonly #getLastAutomaticRunAt?: AgentSchedulerOptions["getLastAutomaticRunAt"];
  readonly #now: () => Date;
  readonly #debounceMs: number;
  #timer?: ReturnType<typeof setTimeout>;
  #dailyTimer?: ReturnType<typeof setTimeout>;
  #running?: Promise<void>;
  #pendingTaskChange = false;
  #disposed = false;

  constructor(options: AgentSchedulerOptions) {
    this.#run = options.run;
    this.#getMemory = options.getMemory;
    this.#getLatestRun = options.getLatestRun;
    this.#getLastAutomaticRunAt = options.getLastAutomaticRunAt;
    this.#now = options.now ?? (() => new Date());
    this.#debounceMs = options.debounceMs ?? 1_500;
  }

  async runStartupIfNeeded(): Promise<void> {
    if (!this.#getMemory().automaticInspectionEnabled) return;
    const latest = this.#getLatestRun();
    const lastAutomaticRunAt = this.#getLastAutomaticRunAt?.() ?? (latest?.trigger !== "manual" ? latest?.completedAt : undefined);
    if (lastAutomaticRunAt && localDateKey(new Date(lastAutomaticRunAt)) === localDateKey(this.#now())) return;
    await this.#execute("startup");
  }

  async runDailyIfNeeded(): Promise<void> {
    if (!this.#getMemory().automaticInspectionEnabled) return;
    const latest = this.#getLatestRun();
    const lastAutomaticRunAt = this.#getLastAutomaticRunAt?.() ?? (latest?.trigger !== "manual" ? latest?.completedAt : undefined);
    if (lastAutomaticRunAt && localDateKey(new Date(lastAutomaticRunAt)) === localDateKey(this.#now())) return;
    await this.#execute("daily");
  }

  startDailyChecks(intervalMs = 60_000): void {
    this.#disposed = false;
    if (this.#dailyTimer) clearTimeout(this.#dailyTimer);
    const tick = async () => {
      try {
        await this.runDailyIfNeeded();
      } catch {
        // Keep the daily watcher alive; the next tick can retry after a transient failure.
      } finally {
        if (!this.#disposed) this.#dailyTimer = setTimeout(() => { void tick(); }, intervalMs);
      }
    };
    this.#dailyTimer = setTimeout(() => { void tick(); }, intervalMs);
  }

  scheduleTaskChange(): void {
    if (!this.#getMemory().automaticInspectionEnabled) return;
    this.#pendingTaskChange = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.flushTaskChanges(); }, this.#debounceMs);
  }

  async flushTaskChanges(): Promise<void> {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#getMemory().automaticInspectionEnabled) {
      this.#pendingTaskChange = false;
      return;
    }
    if (!this.#pendingTaskChange) return;
    if (this.#running) return;
    this.#pendingTaskChange = false;
    await this.#execute("task-change");
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#dailyTimer) clearTimeout(this.#dailyTimer);
    this.#dailyTimer = undefined;
    this.#pendingTaskChange = false;
  }

  async #execute(trigger: AgentRunTrigger): Promise<void> {
    if (this.#running) {
      if (trigger === "task-change") this.#pendingTaskChange = true;
      return;
    }
    this.#running = (async () => {
      await this.#run(trigger);
      while (this.#pendingTaskChange && this.#getMemory().automaticInspectionEnabled) {
        this.#pendingTaskChange = false;
        await this.#run("task-change");
      }
    })().finally(() => { this.#running = undefined; });
    await this.#running;
  }
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
}
