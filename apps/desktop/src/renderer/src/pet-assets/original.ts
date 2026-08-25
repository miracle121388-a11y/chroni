import type { PetAction } from "../../../shared/types";
import chroniMarkUrl from "../../../../build/icon-source.svg?url";

export const petAssetMode = "original" as const;
export const xiaotongDonationQr: string | undefined = undefined;

export const petAnimationFrames = Object.fromEntries([
  "idle",
  "drag",
  "cling",
  "walk",
  "wake",
  "study",
  "eat",
  "pet",
  "play",
  "cat",
  "sleep",
].map((action) => [action, [chroniMarkUrl]])) as Record<PetAction, string[]>;
