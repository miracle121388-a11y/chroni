import { useEffect, useRef, useState } from "react";
import { UiIcon } from "./UiIcon";

type UiDateTimeFieldProps = {
  type: "date" | "datetime-local" | "time";
  value: string;
  onChange(value: string): void;
  ariaLabel?: string;
  disabled?: boolean;
  min?: string;
  required?: boolean;
};

export function UiDateTimeField({ type, value, onChange, ariaLabel, disabled = false, min, required = false }: UiDateTimeFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => displayValue(type, value));

  useEffect(() => {
    setDraft(displayValue(type, value));
  }, [type, value]);

  function updateDraft(next: string): void {
    setDraft(next);
    const canonical = canonicalValue(type, next);
    if (validValue(type, canonical) || (!required && !next)) onChange(canonical);
  }

  function openPicker(): void {
    const picker = pickerRef.current;
    if (!picker || disabled) return;
    try {
      picker.showPicker();
    } catch {
      picker.click();
    }
  }

  return (
    <span className={`ui-date-time-field type-${type}`}>
      <input
        className="ui-date-time-text"
        type="text"
        value={draft}
        inputMode="numeric"
        autoComplete="off"
        aria-label={ariaLabel}
        disabled={disabled}
        required={required}
        pattern={inputPattern(type)}
        placeholder={inputPlaceholder(type)}
        onBlur={() => { if (!validValue(type, canonicalValue(type, draft)) && (required || draft)) setDraft(displayValue(type, value)); }}
        onChange={(event) => updateDraft(event.target.value)}
      />
      <button className="ui-date-time-button" type="button" disabled={disabled} aria-label={type === "time" ? "打开时间选择器" : "打开日期选择器"} onClick={openPicker}>
        <UiIcon name={type === "time" ? "clock" : "calendar"} />
      </button>
      <input
        ref={pickerRef}
        className="ui-date-time-picker"
        type={type}
        value={validValue(type, value) ? value : ""}
        min={min}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

function displayValue(type: UiDateTimeFieldProps["type"], value: string): string {
  return type === "datetime-local" ? value.replace("T", " ") : value;
}

function canonicalValue(type: UiDateTimeFieldProps["type"], value: string): string {
  return type === "datetime-local" ? value.replace(" ", "T") : value;
}

function validValue(type: UiDateTimeFieldProps["type"], value: string): boolean {
  if (type === "date") return validDate(value);
  if (type === "time") return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const [date, time, extra] = value.split("T");
  return !extra && validDate(date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "");
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  return candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
}

function inputPattern(type: UiDateTimeFieldProps["type"]): string {
  if (type === "date") return "\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01])";
  if (type === "time") return "([01]\\d|2[0-3]):[0-5]\\d";
  return "\\d{4}-(0[1-9]|1[0-2])-([0-2]\\d|3[01]) ([01]\\d|2[0-3]):[0-5]\\d";
}

function inputPlaceholder(type: UiDateTimeFieldProps["type"]): string {
  if (type === "date") return "YYYY-MM-DD";
  if (type === "time") return "HH:mm";
  return "YYYY-MM-DD HH:mm";
}
