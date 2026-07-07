/// <reference types="vite/client" />

import type { DueFlowPreferencesPatch, DueFlowSnapshot, ExtractResult, IntakePayload, IntakeResult, ItemPatch } from "../../shared/types";

declare global {
  interface Window {
    dueFlow: {
      getSnapshot(): Promise<DueFlowSnapshot>;
      extract(payload: IntakePayload): Promise<ExtractResult>;
      intake(payload: IntakePayload): Promise<IntakeResult>;
      companionClicked(): Promise<DueFlowSnapshot>;
      companionHover(hovering: boolean): Promise<DueFlowSnapshot>;
      updateItem(id: string, patch: ItemPatch): Promise<DueFlowSnapshot>;
      deleteItem(id: string): Promise<DueFlowSnapshot>;
      updatePreferences(patch: DueFlowPreferencesPatch): Promise<DueFlowSnapshot>;
      quickAdd(text: string): Promise<IntakeResult>;
      openControlCenter(): Promise<void>;
      showSchedule(expanded: boolean): Promise<void>;
      openStorage(): Promise<void>;
      dragWindow(dx: number, dy: number): void;
      filePath(file: File): string;
      onSnapshotUpdated(callback: (snapshot: DueFlowSnapshot) => void): () => void;
    };
  }
}

export {};
