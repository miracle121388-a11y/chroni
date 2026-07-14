const periodPattern = "上午|下午|晚上|中午|凌晨|早上|今晚|明晚|晚";
const chineseNumberPattern = "零〇一二两三四五六七八九十";

export function deadlineDateFromText(text: string, now = new Date()): string | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  const iso = normalized.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?/);
  if (iso) {
    if (iso[7]) {
      const parsed = new Date(iso[0]);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    }
    return localDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]), Number(iso[6] ?? 0));
  }

  const full = normalized.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*[日号]?/);
  if (full) return datedDeadline(Number(full[1]), Number(full[2]), Number(full[3]), normalized);

  const partial = normalized.match(/(\d{1,2})(?:\s*[月/\-]\s*|\.)(\d{1,2})\s*[日号]?/);
  if (partial) {
    const month = Number(partial[1]);
    const day = Number(partial[2]);
    let year = now.getFullYear();
    if (new Date(year, month - 1, day, 23, 59).getTime() < now.getTime()) year += 1;
    return datedDeadline(year, month, day, normalized);
  }

  if (/今天|今日|今早|今晚/.test(normalized)) return relativeDeadline(0, normalized, now);
  if (/明天|明日|明早|明晚/.test(normalized)) return relativeDeadline(1, normalized, now);
  if (/后天|后日/.test(normalized)) return relativeDeadline(2, normalized, now);

  const dayMatch = normalized.match(/(\d+)\s*天后/);
  if (dayMatch) return relativeDeadline(Number(dayMatch[1]), normalized, now);

  const nextWeek = normalized.match(/下(?:个)?(?:周|星期)([一二三四五六日天])/);
  if (nextWeek) return weekdayDeadline(nextWeek[1], normalized, now, true);

  const weekday = normalized.match(/(?:周|星期)([一二三四五六日天])/);
  if (weekday) return weekdayDeadline(weekday[1], normalized, now);
  return undefined;
}

export function stripDeadlineTemporalExpressions(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?/gi, " ")
    .replace(/20\d{2}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}\s*[日号]?/g, " ")
    .replace(/\d{1,2}(?:\s*[月/\-]\s*|\.)\d{1,2}\s*[日号]?/g, " ")
    .replace(new RegExp(`(?:${periodPattern})?\\s*\\d{1,2}\\s*(?:[:：]\\s*\\d{2}|点\\s*(?:\\d{1,2}\\s*分?|半|一刻|三刻)?)`, "g"), " ")
    .replace(new RegExp(`(?:${periodPattern})?\\s*[${chineseNumberPattern}]{1,3}\\s*点\\s*(?:半|一刻|三刻|[${chineseNumberPattern}]{1,3}\\s*分?)?`, "g"), " ")
    .replace(/(今天|今日|今早|今晚|明天|明日|明早|明晚|后天|后日|\d+\s*天后|下(?:个)?(?:周|星期)[一二三四五六日天]?|本周|周[一二三四五六日天]|星期[一二三四五六日天])/g, " ")
    .replace(new RegExp(`(?:${periodPattern})`, "g"), " ");
}

export function isConditionalDeadlineText(text: string): boolean {
  return /(可能|暂定|如果|若|视情况|以.+(?:通知|消息|公告)为准|尚未确定|待确认|待通知|另行通知)/.test(text);
}

function datedDeadline(year: number, month: number, day: number, text: string): string | undefined {
  const time = timeFromText(text);
  if (!time) {
    if (hasUnresolvedPeriod(text)) return undefined;
    return localDate(year, month, day, 23, 59);
  }
  return localDate(year, month, day, time.hour, time.minute);
}

function relativeDeadline(days: number, text: string, now: Date): string | undefined {
  const time = timeFromText(text);
  if (!time) {
    if (hasUnresolvedPeriod(text)) return undefined;
    const endOfDay = new Date(now);
    endOfDay.setDate(endOfDay.getDate() + days);
    endOfDay.setHours(23, 59, 0, 0);
    return endOfDay.toISOString();
  }
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(time.hour, time.minute, 0, 0);
  return date.toISOString();
}

function weekdayDeadline(dayText: string, text: string, now: Date, forceNextWeek = false): string | undefined {
  const target = "一二三四五六日天".indexOf(dayText);
  const targetDay = target >= 6 ? 0 : target + 1;
  const currentDay = now.getDay();
  const diff = forceNextWeek
    ? (((1 - currentDay + 7) % 7) || 7) + (targetDay === 0 ? 6 : targetDay - 1)
    : (targetDay - currentDay + 7) % 7 || 7;
  return relativeDeadline(diff, text, now);
}

function timeFromText(text: string): { hour: number; minute: number } | undefined {
  const numeric = text.match(new RegExp(`(${periodPattern})?\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{2})`))
    ?? text.match(new RegExp(`(${periodPattern})?\\s*(\\d{1,2})\\s*点\\s*(?:(\\d{1,2})\\s*分?)?`));
  if (numeric) return normalizedTime(Number(numeric[2]), Number(numeric[3] ?? 0), numeric[1]);

  const chinese = text.match(new RegExp(`(${periodPattern})?\\s*([${chineseNumberPattern}]{1,3})\\s*点\\s*(半|一刻|三刻|[${chineseNumberPattern}]{1,3}\\s*分?)?`));
  if (!chinese) return undefined;
  const hour = chineseNumber(chinese[2]);
  const minuteText = chinese[3]?.replace(/\s*分$/, "") ?? "";
  const minute = minuteText === "半" ? 30 : minuteText === "一刻" ? 15 : minuteText === "三刻" ? 45 : minuteText ? chineseNumber(minuteText) : 0;
  if (hour === undefined || minute === undefined) return undefined;
  return normalizedTime(hour, minute, chinese[1]);
}

function normalizedTime(hour: number, minute: number, period?: string): { hour: number; minute: number } | undefined {
  if (period === "下午" || period === "晚上" || period === "今晚" || period === "明晚" || period === "晚") {
    if (hour < 12) hour += 12;
  } else if (period === "中午") {
    if (hour < 11) hour += 12;
  } else if (period === "凌晨" && hour === 12) {
    hour = 0;
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

function chineseNumber(value: string): number | undefined {
  const digits: Record<string, number> = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  if (value === "十") return 10;
  const parts = value.split("十");
  if (parts.length === 2) {
    const tens = parts[0] ? digits[parts[0]] : 1;
    const units = parts[1] ? digits[parts[1]] : 0;
    return tens === undefined || units === undefined ? undefined : tens * 10 + units;
  }
  if (value.length === 1) return digits[value];
  const joined = [...value].map((character) => digits[character]);
  return joined.some((digit) => digit === undefined) ? undefined : Number(joined.join(""));
}

function hasUnresolvedPeriod(text: string): boolean {
  return new RegExp(periodPattern).test(text);
}

function localDate(year: number, month: number, day: number, hour: number, minute: number, second = 0): string | undefined {
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return undefined;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return undefined;
  return date.toISOString();
}
