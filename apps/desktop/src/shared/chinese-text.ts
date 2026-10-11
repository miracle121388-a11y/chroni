import { Converter } from "opencc-js/t2cn";

const toSimplified = Converter({ from: "tw", to: "cn" });
export function normalizeChineseText(text: string): string {
  // Do not rewrite actual submission paths, addresses or required filenames.
  return text.split(/(https?:\/\/[^\s，。；<>"']+|[\p{L}\p{N}_@.\-]+\.(?:pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|csv|py|md|com|cn|edu)(?:\b|$))/giu)
    .map((part, index) => index % 2 ? part : toSimplified(part.normalize("NFKC"))).join("");
}
