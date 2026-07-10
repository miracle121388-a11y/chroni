/// <reference types="vite/client" />

import type { ChroniPreferencesPatch, ChroniSnapshot, ExtractResult, IntakePayload, IntakeResult, ItemPatch } from "../../shared/types";

declare global {
  interface Window {
    chroni: {
      platform: "darwin" | "win32" | "linux" | string;
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
      openPetMenu(): Promise<void>;
      showSchedule(expanded: boolean): Promise<void>;
      reprocessSource(sourceId: string): Promise<IntakeResult>;
      updateSourceText(sourceId: string, text: string): Promise<ChroniSnapshot>;
      openStorage(): Promise<void>;
      startWindowDrag(screenX: number, screenY: number): boolean;
      moveWindowDrag(): void;
      endWindowDrag(): void;
      filePath(file: File): string;
      onSnapshotUpdated(callback: (snapshot: ChroniSnapshot) => void): () => void;
    };
  }
}

export {};
