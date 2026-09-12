export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: DISPLAY_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hourCycle: "h23",
});

type Timestamp = string | number | null | undefined;

function parts(value: Timestamp): Record<string, string> | null {
  // API timestamps must identify an instant rather than a machine-local time.
  if (value == null || (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
}

export function formatDate(value: Timestamp): string {
  const date = parts(value);
  return date ? `${date.year}/${date.month}/${date.day}` : "—";
}

export function formatDateTime(value: Timestamp): string {
  const date = parts(value);
  return date ? `${date.year}/${date.month}/${date.day} ${date.hour}:${date.minute}:${date.second}` : "—";
}
