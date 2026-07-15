/// <reference types="vite/client" />

import type { AgentIcsExportResult, AgentMemoryPatch, BehaviorMemoryPatch, ClarificationAnswerPayload, ClarificationResult, ChroniLlmSettings, ChroniUpdateStatus, DailyTaskCreateInput, DailyTaskPatch, ExplicitPreferenceInput, ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, IntakePayload, IntakeResult, ItemPatch, LlmConnectionResult, PetActionCommand, TaskPlanResult, TaskPlanUpdatePayload } from "../../shared/types";

declare global {
  type ChroniControlRoute = {
    tab?: "schedule" | "daily" | "agent" | "preferences" | "services";
    taskId?: string;
    focus?: "clarifications";
  };

  interface Window {
    chroni: {
      platform: "darwin" | "win32" | "linux" | string;
      getSnapshot(): Promise<ChroniSnapshot>;
      getUpdateStatus(): Promise<ChroniUpdateStatus>;
      checkForUpdates(): Promise<ChroniUpdateStatus>;
      installUpdate(): Promise<ChroniUpdateStatus>;
      openReleases(): Promise<void>;
      extract(payload: IntakePayload): Promise<ExtractResult>;
      intake(payload: IntakePayload): Promise<IntakeResult>;
      companionClicked(): Promise<ChroniSnapshot>;
      companionHover(hovering: boolean): Promise<ChroniSnapshot>;
      updateItem(id: string, patch: ItemPatch): Promise<ChroniSnapshot>;
      deleteItem(id: string): Promise<ChroniSnapshot>;
      createDailyTask(input: DailyTaskCreateInput): Promise<ChroniSnapshot>;
      updateDailyTask(id: string, patch: DailyTaskPatch): Promise<ChroniSnapshot>;
      deleteDailyTask(id: string): Promise<ChroniSnapshot>;
      updatePreferences(patch: ChroniPreferencesPatch): Promise<ChroniSnapshot>;
      testLlmConnection(settings: ChroniLlmSettings): Promise<LlmConnectionResult>;
      runDeadlineAgent(): Promise<ChroniSnapshot>;
      updateAgentMemory(patch: AgentMemoryPatch): Promise<ChroniSnapshot>;
      exportAgentIcs(): Promise<AgentIcsExportResult>;
      answerClarification(id: string, payload: ClarificationAnswerPayload): Promise<ClarificationResult>;
      dismissClarification(id: string): Promise<ChroniSnapshot>;
      cancelIntakeDraft(id: string): Promise<ChroniSnapshot>;
      generateTaskPlan(taskId: string, regenerate?: boolean): Promise<TaskPlanResult>;
      activateTaskPlan(taskId: string, planId: string): Promise<TaskPlanResult>;
      updateTaskPlan(taskId: string, payload: TaskPlanUpdatePayload): Promise<TaskPlanResult>;
      updateBehaviorMemory(patch: BehaviorMemoryPatch): Promise<ChroniSnapshot>;
      upsertPlanningPreference(input: ExplicitPreferenceInput): Promise<ChroniSnapshot>;
      setPlanningPreferenceStatus(id: string, status: "active" | "disabled"): Promise<ChroniSnapshot>;
      deletePlanningPreference(id: string): Promise<ChroniSnapshot>;
      clearBehaviorMemory(): Promise<ChroniSnapshot>;
      quickAdd(text: string): Promise<IntakeResult>;
      openControlCenter(route?: ChroniControlRoute): Promise<void>;
      openPetMenu(): Promise<void>;
      showSchedule(expanded: boolean): Promise<void>;
      reprocessSource(sourceId: string): Promise<IntakeResult>;
      updateSourceText(sourceId: string, text: string): Promise<ChroniSnapshot>;
      openStorage(): Promise<void>;
      startWindowDrag(): boolean;
      moveWindowDrag(): void;
      endWindowDrag(): void;
      filePath(file: File): string;
      onSnapshotUpdated(callback: (snapshot: ChroniSnapshot) => void): () => void;
      onUpdateStatus(callback: (status: ChroniUpdateStatus) => void): () => void;
      onPetAction(callback: (command: PetActionCommand) => void): () => void;
      onControlNavigate(callback: (route: ChroniControlRoute) => void): () => void;
    };
  }
}

export {};
