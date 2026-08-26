export type UiIconName = "add" | "arrow-down" | "arrow-left" | "arrow-right" | "arrow-up" | "calendar" | "check" | "clock" | "close" | "inbox" | "review" | "settings" | "spark" | "tasks";

export function UiIcon({ name, className = "inline-icon" }: { name: UiIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {name === "add" && <path d="M8 2.75v10.5M2.75 8h10.5" />}
      {name === "close" && <path d="m3.75 3.75 8.5 8.5m0-8.5-8.5 8.5" />}
      {name === "check" && <path d="m2.75 8.2 3.25 3.2 7.25-7.15" />}
      {name === "arrow-left" && <path d="M13.25 8H2.75m4-4.25L2.5 8l4.25 4.25" />}
      {name === "arrow-right" && <path d="M2.75 8h10.5m-4-4.25L13.5 8l-4.25 4.25" />}
      {name === "arrow-up" && <path d="M8 13.25V2.75M3.75 7 8 2.5 12.25 7" />}
      {name === "arrow-down" && <path d="M8 2.75v10.5M3.75 9 8 13.5 12.25 9" />}
      {name === "calendar" && <><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M5 2v3m6-3v3M2.5 6.5h11" /></>}
      {name === "clock" && <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.75V8l2.4 1.45" /></>}
      {name === "inbox" && <><path d="M2.5 3.25h11v9.5h-11z" /><path d="M2.5 9.25h3l1 1.5h3l1-1.5h3" /></>}
      {name === "review" && <><path d="M3 2.5h10v11H3z" /><path d="M5.25 5.1h5.5M5.25 7.75h5.5M5.25 10.4h3.25" /></>}
      {name === "settings" && <><circle cx="8" cy="8" r="2.25" /><path d="M8 1.75v1.3m0 9.9v1.3M1.75 8h1.3m9.9 0h1.3M3.58 3.58l.92.92m7 7 .92.92m0-9.84-.92.92m-7 7-.92.92" /></>}
      {name === "spark" && <><path d="M8 1.75c.45 2.65 1.6 3.8 4.25 4.25C9.6 6.45 8.45 7.6 8 10.25 7.55 7.6 6.4 6.45 3.75 6 6.4 5.55 7.55 4.4 8 1.75Z" /><path d="M12.2 10.3c.2 1.15.7 1.65 1.85 1.85-1.15.2-1.65.7-1.85 1.85-.2-1.15-.7-1.65-1.85-1.85 1.15-.2 1.65-.7 1.85-1.85Z" /></>}
      {name === "tasks" && <><path d="m2.5 4 1.15 1.15L5.7 3.1M7 4.25h6.5M2.5 8l1.15 1.15L5.7 7.1M7 8.25h6.5M2.5 12l1.15 1.15 2.05-2.05M7 12.25h6.5" /></>}
    </svg>
  );
}
