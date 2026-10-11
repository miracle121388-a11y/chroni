import { posix, extname } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type AdmZip from "adm-zip";
import { markupText, openDocumentText } from "./document-text.js";

type Recognizer = (image: Buffer) => Promise<{ text: string; confidence?: number }>;
const imageTypes = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif", ".avif"]);

function parseXml(value: string): Document {
  return new DOMParser({ errorHandler: { warning: () => undefined, error: () => { throw new Error("Office 文档 XML 结构损坏，请重新导出后导入。"); }, fatalError: () => { throw new Error("Office 文档 XML 结构损坏，请重新导出后导入。"); } } }).parseFromString(value, "application/xml");
}

function relationships(archive: AdmZip, part: string): Map<string, string> {
  const path = posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`);
  const entry = archive.getEntry(path);
  const result = new Map<string, string>();
  if (!entry) return result;
  const nodes = parseXml(entry.getData().toString("utf8")).getElementsByTagName("Relationship");
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes.item(index)!;
    if (node.getAttribute("TargetMode") === "External") continue;
    const target = node.getAttribute("Target") || "";
    const resolved = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(part), target));
    if (!resolved.startsWith("../") && !resolved.includes(":") && !resolved.includes("\\")) result.set(node.getAttribute("Id") || "", resolved);
  }
  return result;
}

/** Read only referenced images, at their actual position in document/slide XML. */
export async function officeDocumentText(archive: AdmZip, extension: string, recognize: Recognizer): Promise<{ text: string; ocrUsed: boolean }> {
  let parts: string[];
  if (extension === ".docx") parts = ["word/document.xml"];
  else if (extension === ".pptx") {
    const presentation = archive.getEntry("ppt/presentation.xml");
    const links = relationships(archive, "ppt/presentation.xml");
    const slides = presentation ? parseXml(presentation.getData().toString("utf8")).getElementsByTagName("p:sldId") : undefined;
    parts = slides ? Array.from({ length: slides.length }, (_, index) => links.get(slides.item(index)!.getAttribute("r:id") || "") || "").filter(Boolean)
      : archive.getEntries().map((entry) => entry.entryName).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } else parts = ["content.xml"];
  let imageCount = 0;
  let ocrUsed = false;
  const cache = new Map<string, string>();
  const texts: string[] = [];
  for (const part of parts) {
    const entry = archive.getEntry(part);
    if (!entry) throw new Error("Office 文档缺少正文或幻灯片，请重新导出后导入。");
    const document = parseXml(entry.getData().toString("utf8"));
    const links = relationships(archive, part);
    const all = document.getElementsByTagName("*");
    const elements = Array.from({ length: all.length }, (_, index) => all.item(index)!);
    for (const element of elements) {
      // Deleted tracked text is not part of the visible task description.
      if (element.tagName === "w:del") { element.parentNode?.removeChild(element); continue; }
      if (!element.parentNode || !["blip", "imagedata", "image"].includes(element.localName || "")) continue;
      const id = element.getAttribute("r:embed") || element.getAttribute("r:id") || "";
      const target = links.get(id) || (element.tagName === "draw:image" ? posix.normalize((element.getAttribute("xlink:href") || "").replace(/^\.\//, "")) : "");
      if (!target || target.startsWith("../") || !imageTypes.has(extname(target).toLowerCase())) continue;
      const image = archive.getEntry(target);
      if (!image) throw new Error("文档引用的图片缺失，请重新导出后导入。");
      if (++imageCount > 60) throw new Error("文档内图片过多，请拆分为每份最多 60 张图片后导入。");
      let text = cache.get(target);
      if (text === undefined) {
        const result = await recognize(image.getData());
        if (result.text.trim() && (result.confidence ?? 0) < 55) throw new Error("文档内图片无法可靠识别，请提供更清晰的图片后导入。");
        text = result.text.trim();
        cache.set(target, text);
      }
      if (text) {
        element.parentNode.replaceChild(document.createTextNode(`\n${text}\n`), element);
        ocrUsed = true;
      }
    }
    const enriched = new XMLSerializer().serializeToString(document).replace(/<w:(?:br|tab)\b[^>]*\/>/g, "\n").replace(/<\/w:tc>/g, "\t").replace(/<\/w:tr>/g, "\n");
    texts.push(extension === ".ods" ? openDocumentText(enriched, true) : markupText(enriched));
  }
  return { text: texts.join("\n\n"), ocrUsed };
}
