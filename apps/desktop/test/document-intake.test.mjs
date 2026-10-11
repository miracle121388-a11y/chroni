import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import sharp from "sharp";
import { extractDdlItemsFromText, extractPayload, processIntake } from "../dist/intake.js";
import { documentText } from "../dist/document-text.js";
import { deadlineDateFromText } from "../dist/shared/deadline-text.js";
import { ChroniStore } from "../dist/store.js";

const anchor = new Date(2026, 9, 11, 12);
const dueAt = new Date(2026, 9, 15, 0).toISOString();
const title = "VAE课程作业2";
const lines = [title, "要求：提供完整PyTorch代码，500行以内。", "重构损失需采用L1损失。", "提交材料：学号-姓名-作业2.pdf", "PDF文档应包含：解题思路、完整代码、实验结果。", "提交网址：https://example.org/submit", "截止日期：2026年10月14日24:00"];
const notice = lines.join("\n");
const options = { referenceNow: anchor, llm: { enabled: false } };
const fixture = readFileSync(new URL("./fixtures/assignment-slide.png", import.meta.url));
const file = (name, content) => ({ name, contentBase64: Buffer.from(content).toString("base64") });
const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function assertAssignment(result) {
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].title, /VAE.*作业\s*2/);
  assert.equal(result.items[0].dueAt, dueAt);
  assert.match(result.items[0].extraction.contextExcerpt, /500/);
  assert.match(result.items[0].extraction.contextExcerpt, /L1/);
  assert.ok(result.items[0].extraction.deliverables.some((entry) => /PDF|pdf/.test(entry)));
}

test("separated assignment heading, requirements and midnight deadline stay together", () => {
  const items = extractDdlItemsFromText(notice, "notice.txt", anchor);
  assertAssignment({ ok: true, items });
  assert.equal(items[0].title, title);
  assert.match(items[0].extraction.submissionMethod, /https:\/\/example.org\/submit/);
  assert.ok(items[0].extraction.constraints.some((entry) => /L1/.test(entry)));
  assert.ok(items[0].extraction.deliverables.includes("实验结果"));
});

test("long paragraphs, URLs, decimals and filenames do not break the deadline sentence", () => {
  const text = `${"实验说明".repeat(100)}。${title}，要求提交学号-姓名-作业2.pdf，采样步长0.3，截止2026年10月14日24:00，提交网址https://example.org/submit。`;
  const items = extractDdlItemsFromText(text, "long.txt", anchor);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, title);
  assert.equal(items[0].dueAt, dueAt);
});

test("deadline labels and date/time split across lines remain parseable", () => {
  for (const deadline of ["截止日期：\n2026年10月14日\n24：00", "日期：2026-10-14\n时间：24:00", "截止日期：２０２６年１０月１４日２４：００"]) {
    const items = extractDdlItemsFromText(`${title}\n${deadline}`, "split.txt", anchor);
    assert.equal(items.length, 1, deadline);
    assert.equal(items[0].title, title);
    assert.equal(items[0].dueAt, dueAt);
  }
});

test("ISO midnight, English dates and AM/PM keep their exact clock", () => {
  assert.equal(deadlineDateFromText("2026-10-14T24:00:00+08:00", anchor), "2026-10-14T16:00:00.000Z");
  assert.equal(deadlineDateFromText("2026-10-14T24:01:00+08:00", anchor), undefined);
  const items = extractDdlItemsFromText("Assignment 2\nDeadline: October 14, 2026 at 11:59 PM", "english.txt", anchor);
  assert.equal(items[0].title, "Assignment 2");
  assert.equal(items[0].dueAt, new Date(2026, 9, 14, 23, 59).toISOString());
  assert.equal(deadlineDateFromText("2026-10-14 18:00 UTC", anchor), "2026-10-14T18:00:00.000Z");
  assert.equal(deadlineDateFromText("2026年10月14日24:00 GMT+8", anchor), "2026-10-14T16:00:00.000Z");
});

test("plain, structured and encoded text formats use the real decoding path", async () => {
  const rtf = `{\\rtf1\\ansi\\uc1 ${[...notice].map((char) => char === "\n" ? "\\par " : char.charCodeAt(0) > 127 ? `\\u${char.charCodeAt(0)}?` : char).join("")}}`;
  const html = `<html><script>假的截止2099-01-01 12:00</script><body>${lines.map((line) => `<p>${xml(line).replace("24:00", "24&#58;00")}</p>`).join("")}</body></html>`;
  const json = JSON.stringify({ title, dueAt, requirements: "提供PyTorch代码，500行以内，L1损失", deliverables: ["报告PDF", "源代码"] });
  const csv = `title,deadline,requirements,deliverables\r\n${title},2026年10月14日24:00,"代码500行以内，L1损失",报告PDF`;
  const tsv = csv.replaceAll(",", "\t");
  const yaml = `title: '${title}'\ndueAt: '${dueAt}'\nrequirements: 代码500行以内，L1损失\ndeliverables: PDF`;
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(notice, "utf16le")]);
  const formats = new Map([...["txt", "md", "log"].map((extension) => [extension, notice]), ["html", html], ["json", json], ["csv", csv], ["tsv", tsv], ["yaml", yaml], ["rtf", rtf], ["custom", notice], ["utf16.txt", utf16]]);
  for (const [format, content] of formats) assertAssignment(await extractPayload({ kind: "files", files: [file(`notice.${format}`, content)] }, options));
  assertAssignment(await extractPayload({ kind: "text", text: json }, options));
  assertAssignment(await extractPayload({ kind: "text", text: csv }, options));
  assertAssignment(await extractPayload({ kind: "files", files: [file("notice.xml", `<notice>${lines.map((line, index) => index === 0 ? `<title>${xml(line)}</title>` : `<p>${xml(line)}</p>`).join("")}</notice>`)] }, options));
});

test("RTF Chinese legacy hex sequences and Unicode controls are decoded", () => {
  assert.equal(documentText("{\\rtf1\\ansi\\ansicpg936 \\'d7\\'f7\\'d2\\'b5\\par \\u25130?\\u27490?}", ".rtf"), "作业\n截止");
});

test("calendar events unfold escaped text, compact timestamps and named timezones", async () => {
  const calendar = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:${title}\r\nDTSTART;TZID=Asia/Shanghai:20261015T000000\r\nDESCRIPTION:代码500行以内\\n重构损失需采用L1损失。\\n提交报告P\r\n DF。\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  assertAssignment(await extractPayload({ kind: "files", files: [file("task.ics", calendar)] }, options));
  const allDay = calendar.replace(";TZID=Asia/Shanghai:20261015T000000", ";VALUE=DATE:20261015");
  const pending = await extractPayload({ kind: "text", text: allDay }, options);
  assert.equal(pending.items.length, 0);
  const invalid = calendar.replace("TZID=Asia/Shanghai", "TZID=Made/Up");
  assert.equal((await extractPayload({ kind: "text", text: invalid }, options)).items.length, 0);
});

test("structured multi-task records retain their own headings and requirements", async () => {
  const entries = [
    { title: "数据库报告", dueAt: "2026-10-14T18:00:00+08:00", deliverables: ["SQL文件"] },
    { title: "视觉作业", dueAt: "2026-10-15T20:00:00+08:00", deliverables: ["图片PNG"] },
  ];
  const result = await extractPayload({ kind: "text", text: JSON.stringify(entries) }, options);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, "数据库报告");
  assert.match(result.items[0].extraction.contextExcerpt, /SQL/);
  assert.doesNotMatch(result.items[0].extraction.contextExcerpt, /PNG/);
  assert.equal(result.items[1].title, "视觉作业");
  assert.doesNotMatch(result.items[1].extraction.contextExcerpt, /SQL/);
});

test("separate bare deadlines use the nearest task heading instead of earlier requirements", () => {
  const items = extractDdlItemsFromText("数据库报告\n截止：2026年10月14日18:00\n报告必须包含SQL查询。\n视觉课程作业2\n要求：提供PyTorch代码，500行以内。\n截止：2026年10月15日20:00", "two-tasks.txt", anchor);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "数据库报告");
  assert.equal(items[1].title, "视觉课程作业2");
  assert.doesNotMatch(items[1].extraction.contextExcerpt, /SQL/);
});

test("imports do not silently discard tasks after the twelfth record", async () => {
  const entries = Array.from({ length: 14 }, (_, index) => ({ title: `课程报告${index + 1}`, dueAt: "2026-10-14T18:00:00+08:00" }));
  const result = await extractPayload({ kind: "text", text: JSON.stringify(entries) }, options);
  assert.equal(result.items.length, 14);
});

function zip(entries) {
  const archive = new AdmZip();
  for (const [name, value] of Object.entries(entries)) archive.addFile(name, Buffer.from(value));
  return archive.toBuffer();
}

test("DOCX, PPTX and OpenDocument files keep multiline Chinese requirements", async () => {
  const docx = zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  });
  assertAssignment(await extractPayload({ kind: "files", files: [file("notice.docx", docx)] }, options));
  const pptx = zip({ "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a">${lines.map((line) => `<a:p><a:r><a:t>${xml(line)}</a:t></a:r></a:p>`).join("")}</p:sld>` });
  assertAssignment(await extractPayload({ kind: "files", files: [file("notice.pptx", pptx)] }, options));
  for (const extension of ["odt", "odp", "ods"]) {
    const document = zip({ mimetype: "application/vnd.oasis.opendocument.text", "content.xml": `<office:document-content xmlns:office="office" xmlns:text="text">${lines.map((line) => `<text:p>${xml(line)}</text:p>`).join("")}</office:document-content>` });
    assertAssignment(await extractPayload({ kind: "files", files: [file(`notice.${extension}`, document)] }, options));
  }
  const ods = zip({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": `<office:document-content xmlns:office="office" xmlns:table="table" xmlns:text="text"><table:table>${[["任务", "截止时间", "要求", "提交物"], [title, "2026年10月14日24:00", "代码500行以内，L1损失", "报告PDF"]].map((row) => `<table:table-row>${row.map((cell) => `<table:table-cell><text:p>${xml(cell)}</text:p></table:table-cell>`).join("")}</table:table-row>`).join("")}</table:table></office:document-content>` });
  assertAssignment(await extractPayload({ kind: "files", files: [file("table.ods", ods)] }, options));
});

test("XLSX reads both sheets and binds column labels to each row", async () => {
  const worksheet = (taskTitle, deadline) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[["title", "deadline", "requirements", "deliverables"], [taskTitle, deadline, "代码500行以内，L1损失", "报告PDF"]].map((row, index) => `<row r="${index + 1}">${row.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const xlsx = zip({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Tasks" sheetId="1" r:id="rId1"/><sheet name="More" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": worksheet(title, "2026年10月14日24:00"),
    "xl/worksheets/sheet2.xml": worksheet("数据库报告", "2026年10月16日18:00"),
  });
  const result = await extractPayload({ kind: "files", files: [file("tasks.xlsx", xlsx)] }, options);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].title, title);
  assert.equal(result.items[0].dueAt, dueAt);
  assert.equal(result.items[1].title, "数据库报告");
});

// Minimal genuine PDF fixtures: text layer, image-only, and mixed pages.
async function pdf(pages) {
  const objects = ["", "<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageReferences = [];
  const add = (value) => { objects.push(value); return objects.length - 1; };
  for (const page of pages) {
    const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    let imageRef;
    if (page.image) {
      const decoded = await loadImage(page.image), canvas = createCanvas(decoded.width, decoded.height);
      canvas.getContext("2d").drawImage(decoded, 0, 0);
      const jpg = canvas.toBuffer("image/jpeg");
      imageRef = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${decoded.width} /Height ${decoded.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`), jpg, Buffer.from("\nendstream")]));
    }
    const stream = `${imageRef ? "q 700 0 0 350 0 0 cm /Im1 Do Q\n" : ""}${(page.text ?? []).map((line, index) => `BT /F1 18 Tf 35 ${450 - index * 30} Td (${line}) Tj ET`).join("\n")}`;
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const pageRef = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 500] /Resources << /Font << /F1 ${font} 0 R >> ${imageRef ? `/XObject << /Im1 ${imageRef} 0 R >>` : ""} >> /Contents ${content} 0 R >>`);
    pageReferences.push(`${pageRef} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pages.length} >>`;
  const buffers = [Buffer.from("%PDF-1.4\n")], offsets = [0];
  let length = buffers[0].length;
  for (let index = 1; index < objects.length; index += 1) {
    offsets.push(length);
    const buffer = Buffer.concat([Buffer.from(`${index} 0 obj\n`), Buffer.from(objects[index]), Buffer.from("\nendobj\n")]);
    buffers.push(buffer); length += buffer.length;
  }
  buffers.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`));
  return Buffer.concat(buffers);
}

test("native PDF text layers produce a grounded task without OCR", async () => {
  const buffer = await pdf([{ text: ["Database assignment", "Deadline: 2026-10-14 24:00", "Submit report PDF and SQL files."] }]);
  const result = await extractPayload({ kind: "files", files: [file("native.pdf", buffer)] }, options);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.items[0].title, "Database assignment");
  assert.equal(result.items[0].dueAt, dueAt);
  assert.equal(result.extracted[0].ocrUsed, false);
  const unnamed = await extractPayload({ kind: "files", files: [file("课程材料", buffer)] }, options);
  assert.equal(unnamed.items[0].dueAt, dueAt);
});

test("image-only and mixed PDFs reach real local OCR in a fresh cache", { timeout: 120_000 }, async () => {
  const cache = mkdtempSync(join(tmpdir(), "chroni-offline-ocr-"));
  const originalCache = process.env.CHRONI_OCR_CACHE_PATH;
  const originalFetch = globalThis.fetch;
  process.env.CHRONI_OCR_CACHE_PATH = cache;
  globalThis.fetch = async () => { throw new Error("Network unavailable in offline OCR test"); };
  try {
    assertAssignment(await extractPayload({ kind: "files", files: [file("scan.pdf", await pdf([{ image: fixture }]))] }, options));
    const mixed = await extractPayload({ kind: "files", files: [file("mixed.pdf", await pdf([{ text: ["Database assignment", "Deadline: 2026-10-13 18:00"] }, { image: fixture }]))] }, options);
    assert.equal(mixed.items.length, 2, mixed.reason);
    assert.equal(mixed.items.some((item) => item.dueAt === dueAt), true);
    assert.equal(mixed.items.some((item) => /Database assignment/.test(item.title)), true);
    // A small text layer on the scan must not suppress the embedded deadline.
    assertAssignment(await extractPayload({ kind: "files", files: [file("overlay.pdf", await pdf([{ text: ["Course overview"], image: fixture }]))] }, options));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCache === undefined) delete process.env.CHRONI_OCR_CACHE_PATH; else process.env.CHRONI_OCR_CACHE_PATH = originalCache;
    rmSync(cache, { recursive: true, force: true });
  }
});

test("PNG, JPEG, WEBP, GIF, TIFF and AVIF use actual OCR", { timeout: 120_000 }, async () => {
  const image = await loadImage(fixture), canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const images = [
    ["png", fixture], ["jpg", canvas.toBuffer("image/jpeg")], ["webp", canvas.toBuffer("image/webp")],
    ["gif", readFileSync(new URL("./fixtures/assignment-slide.gif", import.meta.url))],
    ["tiff", readFileSync(new URL("./fixtures/assignment-slide.tiff", import.meta.url))],
    ["multipage.tiff", readFileSync(new URL("./fixtures/assignment-multipage.tiff", import.meta.url))],
    ["avif", await canvas.encode("avif")],
    ["bmp", bitmap(canvas)],
    ["sideways.png", await sharp(fixture).rotate(90).png().toBuffer()],
    ["upside-down.png", await sharp(fixture).rotate(180).png().toBuffer()],
  ];
  for (const [extension, buffer] of images) {
    const result = await extractPayload({ kind: "files", files: [file(`scan.${extension}`, buffer)] }, options);
    assertAssignment(result);
    assert.equal(result.items[0].extraction.uncertainties.some((entry) => /OCR/.test(entry)), true);
  }
});

function bitmap(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const stride = Math.ceil(width * 3 / 4) * 4;
  const buffer = Buffer.alloc(54 + stride * height);
  buffer.write("BM"); buffer.writeUInt32LE(buffer.length, 2); buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14); buffer.writeInt32LE(width, 18); buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26); buffer.writeUInt16LE(24, 28);
  for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
    const source = ((height - row - 1) * width + column) * 4, target = 54 + row * stride + column * 3;
    buffer[target] = pixels[source + 2]; buffer[target + 1] = pixels[source + 1]; buffer[target + 2] = pixels[source];
  }
  return buffer;
}

test("image-based Office pages also expose a deadline", { timeout: 120_000 }, async () => {
  const pptx = zip({ "ppt/slides/slide1.xml": '<p:sld xmlns:p="p"/>', "ppt/media/image1.png": fixture });
  assertAssignment(await extractPayload({ kind: "files", files: [file("scan.pptx", pptx)] }, options));
});

test("missing deadlines stay resumable and corrupt files report actionable failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chroni-missing-document-"));
  try {
    const store = new ChroniStore(directory);
    store.updatePreferences({ llm: { enabled: false } });
    const result = await processIntake({ kind: "text", text: notice.replace(/截止日期：.*/, "截止日期待通知") }, store, { referenceNow: anchor });
    assert.equal(result.ok, false);
    assert.equal(result.snapshot.items.length, 0);
    assert.equal(result.snapshot.clarifications.some((entry) => entry.field === "dueAt"), true);
    const corrupt = await extractPayload({ kind: "files", files: [file("bad.pdf", "not a pdf"), file("good.txt", notice)] }, options);
    assertAssignment(corrupt);
    assert.equal(corrupt.failures.length, 1);
    const oldOffice = await extractPayload({ kind: "files", files: [file("old.doc", "binary legacy office")] }, options);
    assert.match(oldOffice.reason, /另存为/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
