const rfc3339DateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function isValidCalendarDateTimeParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): boolean {
  return isValidCalendarDate(year, month, day)
    && Number.isInteger(hour)
    && hour >= 0
    && hour <= 23
    && Number.isInteger(minute)
    && minute >= 0
    && minute <= 59
    && Number.isInteger(second)
    && second >= 0
    && second <= 59;
}

export function parseRfc3339DateTime(value: string): Date | undefined {
  const match = value.match(rfc3339DateTimePattern);
  if (!match) return undefined;
  if (!isValidCalendarDateTimeParts(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  )) return undefined;
  if (match[8] !== "Z" && (Number(match[9]) > 23 || Number(match[10]) > 59)) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeRfc3339DateTime(value: string): string | undefined {
  return parseRfc3339DateTime(value)?.toISOString();
}

/** Preserves the older API's Date.parse-compatible inputs while rejecting malformed ISO-like values. */
export function parseCompatibleDateTime(value: string): Date | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) return undefined;
  const rfc3339 = parseRfc3339DateTime(normalizedValue);
  if (rfc3339) return rfc3339;
  const calendarPrefix = normalizedValue.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/);
  if (calendarPrefix && !isValidCalendarDate(Number(calendarPrefix[1]), Number(calendarPrefix[2]), Number(calendarPrefix[3]))) return undefined;
  if (/^\d{4}-\d{2}-\d{2}T/.test(normalizedValue)) return undefined;
  const parsed = new Date(normalizedValue);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeCompatibleDateTime(value: string): string | undefined {
  return parseCompatibleDateTime(value)?.toISOString();
}
