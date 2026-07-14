const periodPattern = "上午|下午|晚上|中午|凌晨|早上|早晨|傍晚|今晚|明晚|晚";
const chineseNumberPattern = "零〇一二两三四五六七八九十";
const clockSuffixPattern = `(?:[:：]\\s*\\d{1,2}|[点时]\\s*(?:\\d{1,2}\\s*分?|半|一刻|三刻)?)`;
const chineseClockSuffixPattern = `[点时]\\s*(?:半|一刻|三刻|[${chineseNumberPattern}]{1,3}\\s*分?)?`;

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
  if (/大后天/.test(normalized)) return relativeDeadline(3, normalized, now);
  if (/后天|后日/.test(normalized)) return relativeDeadline(2, normalized, now);

  const dayMatch = normalized.match(/(\d+)\s*天后/);
  if (dayMatch) return relativeDeadline(Number(dayMatch[1]), normalized, now);

  const weekAfterNext = normalized.match(/下下(?:周|星期)([一二三四五六日天])/);
  if (weekAfterNext) return weekdayDeadline(weekAfterNext[1], normalized, now, "next-next");

  const nextWeek = normalized.match(/下(?:个)?(?:周|星期)([一二三四五六日天])/);
  if (nextWeek) return weekdayDeadline(nextWeek[1], normalized, now, "next");

  const thisWeek = normalized.match(/(?:本|这)(?:周|星期)([一二三四五六日天])/);
  if (thisWeek) return weekdayDeadline(thisWeek[1], normalized, now, "current");

  const previousWeek = normalized.match(/上(?:个)?(?:周|星期)([一二三四五六日天])/);
  if (previousWeek) return weekdayDeadline(previousWeek[1], normalized, now, "previous");

  const weekday = normalized.match(/(?:周|星期)([一二三四五六日天])/);
  if (weekday) return weekdayDeadline(weekday[1], normalized, now, "rolling");
  return undefined;
}

export function stripDeadlineTemporalExpressions(text: string): string {
  return text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?/gi, " ")
    .replace(/20\d{2}\s*[年/.\-]\s*\d{1,2}\s*[月/.\-]\s*\d{1,2}\s*[日号]?/g, " ")
    .replace(/\d{1,2}(?:\s*[月/\-]\s*|\.)\d{1,2}\s*[日号]?/g, " ")
    .replace(new RegExp(`(?:${periodPattern})?\\s*\\d{1,2}\\s*${clockSuffixPattern}`, "g"), " ")
    .replace(new RegExp(`(?:${periodPattern})?\\s*[${chineseNumberPattern}]{1,3}\\s*${chineseClockSuffixPattern}`, "g"), " ")
    .replace(/(今天|今日|今早|今晚|明天|明日|明早|明晚|大后天|后天|后日|\d+\s*天后|下下(?:周|星期)[一二三四五六日天]?|下(?:个)?(?:周|星期)[一二三四五六日天]?|(?:本|这|上(?:个)?)(?:周|星期)[一二三四五六日天]?|周[一二三四五六日天]|星期[一二三四五六日天])/g, " ")
    .replace(new RegExp(`(?:${periodPattern})`, "g"), " ");
}

/**
 * Returns true only when uncertainty applies to the deadline itself. Advisory text
 * such as “如果有问题请联系老师，今晚八点提交” must not block the clear deadline.
 */
export function isConditionalDeadlineText(text: string): boolean {
  const sentences = text.split(/[。；;！？!?\n]+/).map((part) => part.trim()).filter(Boolean);
  return sentences.some((sentence) => {
    const clauses = sentence.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
    const deadlineIndexes = clauses.flatMap((clause, index) => isDeadlineClause(clause) ? [index] : []);
    return deadlineIndexes.some((index) => {
      const clause = clauses[index];
      if (hasDeadlineUncertainty(clause)) return true;

      const following = clauses.slice(index + 1).find((candidate) => hasDeadlineQualifier(candidate));
      if (following) return true;

      const previous = clauses[index - 1];
      return !!previous && /^(?:如果|若|假如|倘若)/.test(previous) && !isStandaloneAdvisoryCondition(previous);
    });
  });
}

function datedDeadline(year: number, month: number, day: number, text: string): string | undefined {
  const time = timeFromText(text);
  if (!time) return undefined;
  const date = new Date(year, month - 1, day, time.hour, time.minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  if (time.dayOffset) date.setDate(date.getDate() + time.dayOffset);
  return date.toISOString();
}

function relativeDeadline(days: number, text: string, now: Date): string | undefined {
  const time = timeFromText(text);
  if (!time) return undefined;
  const date = new Date(now);
  date.setDate(date.getDate() + days + time.dayOffset);
  date.setHours(time.hour, time.minute, 0, 0);
  return date.toISOString();
}

function weekdayDeadline(dayText: string, text: string, now: Date, mode: "rolling" | "current" | "next" | "next-next" | "previous"): string | undefined {
  const targetIndex = "一二三四五六日天".indexOf(dayText);
  if (targetIndex < 0) return undefined;
  const targetFromMonday = targetIndex >= 6 ? 6 : targetIndex;
  const currentFromMonday = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const weekOffset = mode === "next-next" ? 14 : mode === "next" ? 7 : mode === "previous" ? -7 : 0;
  let diff = targetFromMonday - currentFromMonday + weekOffset;
  if (mode === "rolling" && diff < 0) diff += 7;

  let result = relativeDeadline(diff, text, now);
  if (mode === "rolling" && diff === 0 && result && new Date(result).getTime() <= now.getTime()) {
    result = relativeDeadline(7, text, now);
  }
  return result;
}

function timeFromText(text: string): { hour: number; minute: number; dayOffset: number } | undefined {
  const colon = text.match(new RegExp(`(${periodPattern})?\\s*(\\d{1,2})\\s*[:：]\\s*(\\d{1,2})`));
  if (colon) return normalizedTime(Number(colon[2]), Number(colon[3]), colon[1]);

  const numeric = text.match(new RegExp(`(${periodPattern})?\\s*(\\d{1,2})\\s*[点时]\\s*(半|一刻|三刻|\\d{1,2}\\s*分?)?`));
  if (numeric) {
    const minuteText = numeric[3]?.replace(/\s*分$/, "") ?? "";
    const minute = minuteText === "半" ? 30 : minuteText === "一刻" ? 15 : minuteText === "三刻" ? 45 : minuteText ? Number(minuteText) : 0;
    return normalizedTime(Number(numeric[2]), minute, numeric[1]);
  }

  const chinese = text.match(new RegExp(`(${periodPattern})?\\s*([${chineseNumberPattern}]{1,3})\\s*[点时]\\s*(半|一刻|三刻|[${chineseNumberPattern}]{1,3}\\s*分?)?`));
  if (!chinese) return undefined;
  const hour = chineseNumber(chinese[2]);
  const minuteText = chinese[3]?.replace(/\s*分$/, "") ?? "";
  const minute = minuteText === "半" ? 30 : minuteText === "一刻" ? 15 : minuteText === "三刻" ? 45 : minuteText ? chineseNumber(minuteText) : 0;
  if (hour === undefined || minute === undefined) return undefined;
  return normalizedTime(hour, minute, chinese[1]);
}

function normalizedTime(hour: number, minute: number, period?: string): { hour: number; minute: number; dayOffset: number } | undefined {
  let dayOffset = 0;
  if (hour === 24 && minute === 0) {
    return { hour: 0, minute, dayOffset: 1 };
  }
  if (period === "下午" || period === "晚上" || period === "今晚" || period === "明晚" || period === "晚" || period === "傍晚") {
    if ((hour === 0 || hour === 12) && (period === "晚上" || period === "今晚" || period === "明晚" || period === "晚")) {
      hour = 0;
      dayOffset = 1;
    } else if (hour < 12) hour += 12;
  } else if (period === "中午") {
    if (hour < 11) hour += 12;
  } else if (period === "凌晨" && hour === 12) {
    hour = 0;
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute, dayOffset };
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

function isDeadlineClause(text: string): boolean {
  return hasTemporalReference(text) && /(截止|截至|提交|完成|上交|交付|考试|答辩|汇报|展示|会议|活动|ddl|deadline|due|submit|turn\s*in)/i.test(text);
}

function hasTemporalReference(text: string): boolean {
  return /20\d{2}\s*[年/.\-]|\d{1,2}\s*[月/.\-]\s*\d{1,2}|今天|今日|今晚|明天|明日|明晚|后天|后日|\d+\s*天后|(?:上|下|本|这)?(?:个)?(?:周|星期)[一二三四五六日天]|第[一二三四五六七八九十\d]+节|上午|下午|晚上|中午|凌晨|早上|早晨|傍晚|\d{1,2}\s*[:：点时]/i.test(text);
}

function hasDeadlineUncertainty(text: string): boolean {
  return /(可能|暂定|预计|大约|大概|左右|前后|尚未确定|待确认|视情况|时间待定|日期待定)/.test(text)
    || /^(?:如果|若|假如|倘若)/.test(text)
    || hasDeadlineQualifier(text);
}

function hasDeadlineQualifier(text: string): boolean {
  if (/(地点|方式|名单|内容|材料|要求).*(?:待通知|另行通知|为准)/.test(text)) return false;
  return /(?:最终)?以.*(?:通知|消息|公告)为准|(?:截止|日期|时间).*(?:可能|暂定|预计|待通知|另行通知|尚未确定|调整|变更|有变)|^(?:最终)?(?:待通知|另行通知|尚未确定)$/.test(text);
}

function isStandaloneAdvisoryCondition(text: string): boolean {
  return /(有问题|有疑问|需要帮助|不清楚).*(联系|咨询|询问|反馈)|(?:联系|咨询|询问).*(老师|助教|负责人|客服)/.test(text);
}

function localDate(year: number, month: number, day: number, hour: number, minute: number, second = 0): string | undefined {
  if (![year, month, day, hour, minute, second].every(Number.isInteger)) return undefined;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return undefined;
  return date.toISOString();
}
