import type { PetAction } from "../../../shared/types";
import * as selected from "./xiaotong";

export const petAssetMode: "original" | "xiaotong" = selected.petAssetMode;
export const petAnimationFrames: Record<PetAction, string[]> = selected.petAnimationFrames;
export const xiaotongDonationQr: string | undefined = selected.xiaotongDonationQr;
