import { addDays, daysBetween, todayStr } from "./task.js";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function dow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  // Clamp to the month's last day: Jan 31 + 1 month → Feb 28, not Mar 3.
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

/** `month` is 0-based and may run past December. */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month + 1, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The next date after `from` for an Obsidian Tasks-style rule, or null when the rule
 * isn't one we understand. Supports: every [N] day(s)/week(s)/month(s)/year(s),
 * every weekday, every <weekday name>, every [N] month(s) on the last (the Tasks plugin's
 * wording for the month's last day, which plain "every month" can't hold: 31 Oct → 30 Nov
 * → 30 Dec … drifts).
 */
export function nextDate(rule: string, from: string): string | null {
  const r = rule.trim().toLowerCase().replace(/\s+when done$/, "");
  let m: RegExpExecArray | null;

  if ((m = /^every (?:(\d+) )?(day|week|month|year)s?$/.exec(r))) {
    const n = Number(m[1] ?? 1);
    switch (m[2]) {
      case "day": return addDays(from, n);
      case "week": return addDays(from, 7 * n);
      case "month": return addMonths(from, n);
      case "year": return addMonths(from, 12 * n);
    }
  }
  if ((m = /^every (?:(\d+) )?months? on the last(?: day)?$/.exec(r))) {
    // The end of `from`'s month if that's still ahead, else the end of the month N on.
    const [y, mo] = from.split("-").map(Number);
    const thisEnd = lastDayOfMonth(y, mo - 1);
    return thisEnd > from ? thisEnd : lastDayOfMonth(y, mo - 1 + Number(m[1] ?? 1));
  }
  if (r === "every weekday") {
    let d = addDays(from, 1);
    while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
    return d;
  }
  if ((m = /^every (sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(r))) {
    const want = WEEKDAYS.indexOf(m[1]);
    let d = addDays(from, 1);
    while (dow(d) !== want) d = addDays(d, 1);
    return d;
  }
  return null;
}

export interface Dates {
  start: string | null;
  scheduled: string | null;
  due: string | null;
}

/**
 * Dates for the next occurrence. Like the Tasks plugin, the reference is due, else
 * scheduled, else start ("when done" rules use today instead), and every date moves by
 * the same offset. A task with no dates at all gets the next date as its scheduled date.
 *
 * Unlike the plugin, the next occurrence always lands after `today`: completing a weekly
 * task three weeks late means you've caught up, so the missed weeks are skipped rather
 * than recreated as overdue copies. Pass `catchUp: false` for the plugin's exact result.
 * Returns null for a rule we can't parse.
 */
export function nextOccurrence(
  rule: string,
  dates: Dates,
  today = todayStr(),
  { catchUp = true }: { catchUp?: boolean } = {},
): Dates | null {
  const whenDone = /\swhen done$/i.test(rule.trim());
  const ref = dates.due ?? dates.scheduled ?? dates.start;
  let next = nextDate(rule, whenDone || !ref ? today : ref);
  if (!next) return null;
  while (catchUp && next <= today) next = nextDate(rule, next)!;
  if (!ref) return { start: null, scheduled: next, due: null };

  // Move the reference date onto `next` and every other date by the same offset.
  const offset = daysBetween(ref, next);
  const shift = (d: string | null) => (d ? addDays(d, offset) : null);
  return { start: shift(dates.start), scheduled: shift(dates.scheduled), due: shift(dates.due) };
}
