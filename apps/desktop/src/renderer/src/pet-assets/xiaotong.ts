import type { PetAction } from "../../../shared/types";
import xiaotongDonationQrBase64 from "../../../../third_party/xiaotong/donate_qr.b64?raw";

const modules = import.meta.glob("../assets/tongluv/frames/*/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function collect(action: PetAction): string[] {
  return Object.entries(modules)
    .filter(([path]) => path.includes(`/frames/${action}/`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, url]) => url);
}

export const petAssetMode = "xiaotong" as const;
export const xiaotongDonationQr = `data:image/jpeg;base64,${xiaotongDonationQrBase64.replace(/\s+/g, "")}`;
export const petAnimationFrames: Record<PetAction, string[]> = {
  idle: collect("idle"),
  drag: collect("drag"),
  cling: collect("cling"),
  walk: collect("walk"),
  wake: collect("wake"),
  study: collect("study"),
  eat: collect("eat"),
  pet: collect("pet"),
  play: collect("play"),
  cat: collect("cat"),
  sleep: collect("sleep"),
};
