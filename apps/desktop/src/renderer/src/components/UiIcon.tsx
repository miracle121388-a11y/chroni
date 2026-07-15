export type UiIconName = "add" | "arrow-down" | "arrow-left" | "arrow-up" | "calendar" | "check" | "clock" | "close";

export function UiIcon({ name, className = "inline-icon" }: { name: UiIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {name === "add" && <path d="M8 2.75v10.5M2.75 8h10.5" />}
      {name === "close" && <path d="m3.75 3.75 8.5 8.5m0-8.5-8.5 8.5" />}
      {name === "check" && <path d="m2.75 8.2 3.25 3.2 7.25-7.15" />}
      {name === "arrow-left" && <path d="M13.25 8H2.75m4-4.25L2.5 8l4.25 4.25" />}
      {name === "arrow-up" && <path d="M8 13.25V2.75M3.75 7 8 2.5 12.25 7" />}
      {name === "arrow-down" && <path d="M8 2.75v10.5M3.75 9 8 13.5 12.25 9" />}
      {name === "calendar" && <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M5 2v3m6-3v3M2.5 6.5h11" /></>}
      {name === "clock" && <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.75V8l2.4 1.45" /></>}
    </svg>
  );
}
