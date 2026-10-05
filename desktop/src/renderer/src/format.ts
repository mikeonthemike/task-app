import type { WidgetTask } from "../../shared/api";

const DAY_MS = 86_400_000;

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function longDate(date: string): string {
  return parse(date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/** "today", "tomorrow", "2d overdue", "Fri 26 Sep". */
export function relativeDate(date: string, today: string): string {
  const diff = Math.round((parse(date).getTime() - parse(today).getTime()) / DAY_MS);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff < 0) return `${-diff}d ago`;
  return parse(date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function estimate(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h${m}m` : h ? `${h}h` : `${m}m`;
}

/** The small grey line under a title: where it lives, how long, and when it's due. */
export function metaParts(t: WidgetTask, today: string, hideWhere = false): { text: string; urgent?: boolean }[] {
  const parts: { text: string; urgent?: boolean }[] = [];
  if (t.waitingOn !== null) parts.push({ text: t.waitingOn ? `waiting on ${t.waitingOn}` : "waiting" });
  if (!hideWhere && (t.project ?? t.area)) parts.push({ text: (t.project ?? t.area)! });
  if (t.estimateMinutes) parts.push({ text: estimate(t.estimateMinutes) });
  if (t.due) parts.push({ text: `due ${relativeDate(t.due, today)}`, urgent: t.due <= today });
  else if (t.scheduled && t.scheduled < today) parts.push({ text: `from ${relativeDate(t.scheduled, today)}`, urgent: !t.done });
  else if (t.scheduled && t.scheduled > today) parts.push({ text: relativeDate(t.scheduled, today) });
  return parts;
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + n);
  return iso(d);
}

/** The next given weekday after `date` (0 = Sunday), never `date` itself. */
export function nextWeekday(date: string, weekday: number): string {
  const diff = (weekday - parse(date).getDay() + 7) % 7 || 7;
  return addDays(date, diff);
}
