import { isValidCalendarDateTimeParts } from "./shared/date-time.js";
import { normalizeChineseText } from "./shared/chinese-text.js";

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, entity: string) => {
    const names: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    if (!entity.startsWith("#")) return names[entity.toLowerCase()] ?? original;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : original;
  });
}

export function markupText(text: string): string {
  return decodeEntities(text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|text:p|text:h|a:p|w:p)>|<(?:br|hr)\b[^>]*\/?\s*>/gi, "\n")
    .replace(/<\/(?:td|th|table:table-cell)>/gi, "\t")
    .replace(/<(title|summary|name|task|deadline|dueAt|deliverables)\b[^>]*>/gi, (_match, key: string) => `${fieldLabel(key)}: `)
    .replace(/<\/(?:title|summary|name|task|deadline|dueAt|description|deliverables)>/gi, "\n")
    .replace(/<[^>]+>/g, ""));
}

/** Decode formats before extracting dates; raw markup is not task evidence. */
export function documentText(raw: string, extension = ""): string {
  return normalizeChineseText(decodeDocumentText(raw, extension));
}

function decodeDocumentText(raw: string, extension = ""): string {
  const text = raw.replace(/^\uFEFF/, "");
  if (/^\s*BEGIN:VCALENDAR/i.test(text) || extension === ".ics") return calendarText(text);
  if (/^\s*{\\rtf/i.test(text) || extension === ".rtf") return rtfText(text);
  if (extension === ".json" || /^[\s]*[\[{]/.test(text)) {
    try {
      const parsed: unknown = JSON.parse(text);
      return jsonText(parsed);
    } catch { /* Natural text may also start with a bracket. */ }
  }
  if ([".html", ".htm", ".xml"].includes(extension) || /<(?:html|body|p|div|table|h[1-6])\b/i.test(text)) return markupText(text);
  const firstLine = text.split(/\r?\n/, 1)[0];
  const pastedTable = /(?:^|[,\t])\s*(?:deadline|dueAt|截止时间|截止日期)\s*(?:[,\t]|$)/i.test(firstLine);
  if (extension === ".csv" || extension === ".tsv" || pastedTable) {
    return tabularText(parseDelimited(text, extension === ".tsv" || (pastedTable && firstLine.includes("\t")) ? "\t" : ","));
  }
  return text.replace(/^(\s*-?\s*)(title|name|summary|task|dueAt|due|deadline|deliverables)\s*:\s*(.*)$/gmi, (_match, prefix: string, key: string, value: string) => `${prefix}${fieldLabel(key)}: ${value.replace(/^["']|["']$/g, "")}`);
}

export function tabularText(rows: string[][]): string {
  const nonempty = rows.filter((row) => row.some((cell) => cell.trim()));
  if (!nonempty.length) return "";
  const headers = nonempty[0];
  const hasHeaders = headers.some((cell) => /^(?:任务|事项|标题|名称|作业|课程|截止(?:时间|日期)?|日期|时间|提交物|提交要求|task|title|name|summary|deadline|due(?:at)?|date|time|deliverables)$/i.test(cell.trim()));
  if (!hasHeaders) return nonempty.map((row) => row.join(", ")).join("\n");
  return nonempty.slice(1).map((row, index) => {
    const fields = row.map((cell, column) => `${fieldLabel(headers[column] || "内容")}: ${cell}`).join("\n");
    return `[任务 ${index + 1}]\n${fields}`;
  }).join("\n\n");
}

export function openDocumentText(source: string, spreadsheet: boolean): string {
  if (!spreadsheet) return markupText(source);
  const tables = [...source.matchAll(/<table:table\b[^>]*>([\s\S]*?)<\/table:table>/g)];
  if (!tables.length) return markupText(source);
  return tables.map((table) => {
    const rows = [...table[1].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)].map((row) => {
      const cells: string[] = [];
      for (const cell of row[1].matchAll(/<table:(?:table-cell|covered-table-cell)\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/g)) {
        const value = markupText(cell[2] ?? "").trim();
        const repeat = Number(cell[1].match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1);
        if (repeat > 2000 && !value && !row[1].slice((cell.index ?? 0) + cell[0].length).trim()) continue;
        if (repeat > 2000) throw new Error("表格重复列过多，请简化为普通表格后导入。");
        cells.push(...Array.from({ length: repeat }, () => value));
      }
      return cells;
    });
    return tabularText(rows);
  }).join("\n\n");
}

function fieldLabel(key: string): string {
  if (/^(title|name|summary|task|任务|事项|标题|名称|作业|课程)$/i.test(key)) return "任务名称";
  if (/^(dueAt|due|deadline|截止日期|截止时间)$/i.test(key)) return "截止时间";
  if (/^(deliverables|提交物)$/i.test(key)) return "提交物";
  return key;
}

function jsonText(value: unknown, depth = 0): string {
  if (depth > 30) throw new Error("结构化文本嵌套过深，请简化后重试。");
  if (Array.isArray(value)) return value.map((entry, index) => typeof entry === "object" && entry !== null
    ? `[任务 ${index + 1}]\n${jsonText(entry, depth + 1)}` : String(entry ?? "")).join("\n\n");
  if (!value || typeof value !== "object") return String(value ?? "");
  return Object.entries(value).map(([key, entry]) => {
    if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) return `${fieldLabel(key)}: ${entry.join("、")}`;
    if (entry && typeof entry === "object") return jsonText(entry, depth + 1);
    return `${fieldLabel(key)}: ${String(entry ?? "")}`;
  }).join("\n");
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && (char === delimiter || char === "\n" || char === "\r")) {
      row.push(cell.trim()); cell = "";
      if (char !== delimiter) {
        rows.push(row); row = [];
        if (char === "\r" && text[index + 1] === "\n") index += 1;
      }
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

function calendarText(text: string): string {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const events = [...unfolded.matchAll(/BEGIN:(VEVENT|VTODO)\r?\n([\s\S]*?)END:\1/gi)];
  return events.map((event, index) => {
    const properties = event[2].split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([^:;]+)((?:;[^:]*)?):(.*)$/);
      return match ? [{ key: match[1].toUpperCase(), params: match[2], value: match[3] }] : [];
    });
    const time = properties.find((property) => property.key === (event[1].toUpperCase() === "VTODO" ? "DUE" : "DTSTART"));
    const get = (key: string) => unescapeCalendar(properties.find((property) => property.key === key)?.value ?? "");
    return `[任务 ${index + 1}]\n任务名称: ${get("SUMMARY")}\n截止时间: ${time ? calendarTime(time.value, time.params) : "未说明"}\n${get("DESCRIPTION")}\n${get("LOCATION")}\n${get("URL")}`;
  }).join("\n\n");
}

function unescapeCalendar(text: string): string {
  return text.replace(/\\[nN]/g, "\n").replace(/\\([,;\\])/g, "$1");
}

function calendarTime(value: string, params: string): string {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return value;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map((part) => Number(part ?? 0));
  if (!isValidCalendarDateTimeParts(year, month, day, hour, minute, second)) return "日期无效";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  if (!match[4]) return `${date}（全天，未指定具体钟点）`;
  const stamp = `${date}T${match[4]}:${match[5]}:${match[6]}`;
  if (match[7]) return `${stamp}Z`;
  const timezone = params.match(/;TZID=([^;]+)/i)?.[1]?.replace(/^"|"$/g, "");
  if (!timezone) return stamp;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const wallTime = Date.UTC(year, month - 1, day, hour, minute, second);
    let instant = wallTime;
    const offsetAt = (at: number) => {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - at;
    };
    for (let iteration = 0; iteration < 3; iteration += 1) instant = wallTime - offsetAt(instant);
    if (instant + offsetAt(instant) !== wallTime) return `${date}（时区钟点不存在，需确认）`;
    // DST fall-back (including half-hour transitions) can map two instants to
    // the same wall clock. A local date/time alone cannot select one safely.
    if ([-120, -60, -30, 30, 60, 120].some((minutes) => { const alternative = instant + minutes * 60_000; return alternative + offsetAt(alternative) === wallTime; })) return `${date}（时区钟点有歧义，需确认）`;
    return new Date(instant).toISOString();
  } catch { return `${date}（时区无效，需确认）`; }
}

function rtfText(text: string): string {
  const encoding = text.match(/\\ansicpg(\d+)/)?.[1] === "1252" ? "windows-1252" : "gb18030";
  let result = "", skip = false, fallback = 1;
  const groups: Array<{ skip: boolean; fallback: number }> = [];
  for (let index = 0; index < text.length;) {
    const char = text[index++];
    if (char === "{") { groups.push({ skip, fallback }); continue; }
    if (char === "}") { const group = groups.pop(); if (group) ({ skip, fallback } = group); continue; }
    if (char !== "\\") { if (!skip && char !== "\r" && char !== "\n") result += char; continue; }
    if (/[{}\\]/.test(text[index] ?? "")) { if (!skip) result += text[index]; index += 1; continue; }
    if (text[index] === "*") { skip = true; index += 1; continue; }
    if (text[index] === "'") {
      const bytes: number[] = [];
      while (true) {
        bytes.push(parseInt(text.slice(index + 1, index + 3), 16)); index += 3;
        if (text.slice(index, index + 2) !== "\\'") break;
        index += 1;
      }
      if (!skip) result += new TextDecoder(encoding).decode(Uint8Array.from(bytes));
      continue;
    }
    const token = text.slice(index).match(/^([a-z]+)(-?\d+)? ?/i);
    if (!token) { index += 1; continue; }
    index += token[0].length;
    const [, word, parameter] = token;
    if (/^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer)$/i.test(word)) skip = true;
    if (word === "uc") fallback = Number(parameter ?? 1);
    if (!skip && /^(par|line|row)$/.test(word)) result += "\n";
    if (!skip && /^(tab|cell)$/.test(word)) result += "\t";
    if (word === "u" && parameter) {
      if (!skip) result += String.fromCharCode(Number(parameter) & 0xffff);
      for (let count = 0; count < fallback && index < text.length; count += 1) {
        index += text.slice(index, index + 2) === "\\'" ? 4 : 1;
      }
    }
  }
  return result;
}
