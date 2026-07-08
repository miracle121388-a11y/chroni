/// <reference types="vite/client" />

import type { ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, IntakePayload, IntakeResult, ItemPatch } from "../../shared/types";

declare global {
  interface Window {
    chroni: {
      getSnapshot(): Promise<ChroniSnapshot>;
      extract(payload: IntakePayload): Promise<ExtractResult>;
      intake(payload: IntakePayload): Promise<IntakeResult>;
      companionClicked(): Promise<ChroniSnapshot>;
      companionHover(hovering: boolean): Promise<ChroniSnapshot>;
      updateItem(id: string, patch: ItemPatch): Promise<ChroniSnapshot>;
      deleteItem(id: string): Promise<ChroniSnapshot>;
      updatePreferences(patch: ChroniPreferencesPatch): Promise<ChroniSnapshot>;
      quickAdd(text: string): Promise<IntakeResult>;
      openControlCenter(): Promise<void>;
      showSchedule(expanded: boolean): Promise<void>;
      openStorage(): Promise<void>;
      dragWindow(dx: number, dy: number): void;
      filePath(file: File): string;
      onSnapshotUpdated(callback: (snapshot: ChroniSnapshot) => void): () => void;
    };
  }
}

export {};
