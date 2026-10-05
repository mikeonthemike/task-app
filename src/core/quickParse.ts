import * as chrono from "chrono-node";
import { nextDate } from "./recurrence.js";
import type { NewTaskInput } from "./task.js";
import { addDays } from "./task.js";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const DAYS: Record<string, string> = {
  mon: "monday", tue: "tuesday", tues: "tuesday", wed: "wednesday", thu: "thursday", thur: "thursday",
  thurs: "thursday", fri: "friday", sat: "saturday", sun: "sunday",
};
const DAY_RE = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun";

/**
 * "every monday", "every 2 weeks", "every other week", "every weekday", "every month when done":
 * the rules `nextDate` understands, plus day abbreviations and "other" (= 2). A following "from" or
 * "starting" goes with the rule, so chrono sees only the date ("from 12" would read as noon).
 * "every month by end of month" / "on the last day" / "every month end" is the month's last day,
 * whatever its length; "every week by end of week" is every Friday.
 */
const RULE_RE = new RegExp(
  `\\bevery\\s+(?:(weekday)|(${DAY_RE})|(?:(\\d+|other)\\s+)?(day|week|month|year)s?)\\b(\\s+(?:(?:(?:due\\s+)?by|on|at)\\s+(?:the\\s+)?(?:end\\s+of\\s+(?:the\\s+)?(?:month|week)|last(?:\\s+day)?(?:\\s+of\\s+(?:the\\s+)?month)?)|end)\\b)?(\\s+when\\s+done\\b)?(?:\\s+(?:from|starting(?:\\s+on)?)\\b)?`,
  "i",
);

function takeRule(text: string): { rule: string; rest: string } | null {
  const m = RULE_RE.exec(text);
  if (!m) return null;
  const [whole, weekday, day, n, unit, atEnd, whenDone] = m;
  let rule: string;
  let keep = "";
  if (weekday) rule = "every weekday";
  else if (day) rule = `every ${DAYS[day.toLowerCase()] ?? day.toLowerCase()}`;
  else {
    const count = n?.toLowerCase() === "other" ? 2 : Number(n ?? 1);
    rule = count === 1 ? `every ${unit.toLowerCase()}` : `every ${count} ${unit.toLowerCase()}s`;
    const u = unit.toLowerCase();
    if (atEnd && u === "month" && !/week/i.test(atEnd)) rule += " on the last";
    else if (atEnd && u === "week" && count === 1 && /week/i.test(atEnd)) rule = "every friday";
    else if (atEnd) keep = atEnd; // no end-of rule for this unit; the end-of reader dates it instead
  }
  if (whenDone) rule += " when done";
  return { rule, rest: `${text.slice(0, m.index)} ${keep} ${text.slice(m.index + whole.length)}` };
}

/** First occurrence on or after today: the next matching day for a weekday or month-end rule, today otherwise. */
function firstOccurrence(rule: string, today: string): string {
  return /^every (weekday|[a-z]+day)\b| on the last/.test(rule) ? nextDate(rule, addDays(today, -1))! : today;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * "end of the month", "by end of October", "EOW": chrono doesn't know these, so they're read here.
 * A leading "by"/"due" goes with the phrase. The week ends on Friday (the working week).
 */
const END_RE = new RegExp(
  `(^|[\\s(])((?:due\\s+)?by\\s+|due\\s+)?(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?(?:(this|next)\\s+)?(day|week|month|quarter|year|${MONTH_RE})(?:\\s+(\\d{4}))?|(eod|eow|eom|eoy))\\b`,
  "i",
);

const lastOfMonth = (y: number, m: number) => iso(new Date(y, m + 1, 0)); // m is 0-based

/**
 * A monthly repeat starting on a month's last day ("every month from 31 Oct") means month end.
 * Plain "every month" would keep the day number and drift (31 Oct → 30 Nov → 30 Dec …), so it
 * becomes "on the last". "when done" counts from completion, so it's left as it is.
 */
function anchorRule(rule: string, date: string): string {
  if (!/^every (?:\d+ )?months?$/.test(rule)) return rule;
  const [y, m] = date.split("-").map(Number);
  return date === lastOfMonth(y, m - 1) ? `${rule} on the last` : rule;
}

function takeEndOf(text: string, now: Date): { date: string; rest: string; phrase: string; deadline: boolean; rolled: boolean } | null {
  const m = END_RE.exec(text);
  if (!m) return null;
  const [whole, lead, byDue, which, unitRaw, year, short] = m;
  const unit = short ? { eod: "day", eow: "week", eom: "month", eoy: "year" }[short.toLowerCase()]! : unitRaw.toLowerCase();
  const next = which?.toLowerCase() === "next";
  const today = iso(now);
  const y = now.getFullYear();
  const mo = now.getMonth();
  let date: string;
  let rolled = false;
  if (unit === "day") date = today;
  else if (unit === "week") {
    date = nextDate("every friday", addDays(today, -1))!; // this week's Friday, or the coming one at a weekend
    if (next) date = addDays(date, 7);
  } else if (unit === "month") date = lastOfMonth(y, mo + (next ? 1 : 0));
  else if (unit === "quarter") date = lastOfMonth(y, Math.floor(mo / 3) * 3 + 2 + (next ? 3 : 0));
  else if (unit === "year") date = iso(new Date(y + (next ? 1 : 0), 11, 31));
  else {
    const month = MONTHS.findIndex((name) => name.startsWith(unit.slice(0, 3)));
    date = lastOfMonth(year ? Number(year) : y, month);
    if (!year && date < today) {
      date = lastOfMonth(y + 1, month);
      rolled = true;
    }
  }
  return { date, rest: text.slice(0, m.index) + lead + text.slice(m.index + whole.length), phrase: whole.slice(lead.length), deadline: !!byDue, rolled };
}

const tidy = (s: string) =>
  s
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/** How "9/10" reads: day first (9 Oct, the UK default) or month first (Sep 10, US). */
export type DateOrder = "dmy" | "mdy";

export interface QuickParseOptions {
  dateOrder?: DateOrder;
}

/** `warning` says why a date in the text was left alone, for the caller to show the user. */
export type QuickParseResult = NewTaskInput & { warning?: string };

/**
 * A date with no year that only lands in the future by rolling into next year, and then more
 * than this many days out, is more likely a misread (or a typo for a date just gone) than a plan
 * for next year: typed on 6 Oct, "10 Sep" would be 10 Sep next year.
 */
const MAX_ROLLOVER_DAYS = 183;

const pretty = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const rolloverWarning = (phrase: string, date: string) =>
  `"${phrase.trim()}" would mean ${pretty(date)}, so it was left in the title. Add the year if that's right.`;

/**
 * Local fallback capture parser (no Claude): pulls a date out with chrono-node, rest is the title.
 * Never infers a date in the past: ambiguous phrases resolve forwards ("weekend" = the coming one),
 * and anything still before `now` is ignored, leaving the title untouched. A yearless date that
 * would only be future by jumping more than ~6 months into next year is ignored too, with a warning.
 *
 * Numeric dates are day first unless `dateOrder: "mdy"`: "by 9/10" is 9 October.
 *
 * A date introduced by "by"/"due" ("by friday", "due 12 Oct", "by end of month") is the due date;
 * any other date is the scheduled date.
 *
 * A repeat phrase ("every monday") becomes the recurrence and is taken out before chrono runs, so
 * "monday" isn't read as a one-off date. The first occurrence is an explicit date in the text
 * ("every monday from 12 oct"), else the next matching day (today if it matches).
 *
 * "End of …" phrases (month, week, quarter, year, a named month, EOD/EOW/EOM/EOY) resolve to the
 * last day of that period.
 */
export function quickParse(text: string, now: Date = new Date(), options: QuickParseOptions = {}): QuickParseResult {
  const today = iso(now);
  const repeat = takeRule(text);
  const source = repeat ? repeat.rest : text;
  const tooFar = (date: string) => date > addDays(today, MAX_ROLLOVER_DAYS);

  const noDate = (warning?: string): QuickParseResult => {
    const w = warning ? { warning } : {};
    if (!repeat) return { title: text.trim(), ...w };
    return { title: tidy(source) || text.trim(), recurrence: repeat.rule, scheduled: firstOccurrence(repeat.rule, today), ...w };
  };
  const dated = (title: string, date: string, deadline: boolean): QuickParseResult => ({
    title: title || text.trim(),
    ...(deadline ? { due: date } : { scheduled: date }),
    ...(repeat && { recurrence: anchorRule(repeat.rule, date) }),
  });

  const endOf = takeEndOf(source, now);
  if (endOf && endOf.date >= today) {
    if (endOf.rolled && tooFar(endOf.date)) {
      return noDate(rolloverWarning(endOf.phrase, endOf.date));
    }
    return dated(tidy(endOf.rest), endOf.date, endOf.deadline);
  }

  const parser = options.dateOrder === "mdy" ? chrono.en.casual : chrono.en.GB;
  const results = parser.parse(source, now, { forwardDate: true });
  const result = results.find((r) => iso(r.date()) >= today);
  if (!result) return noDate();
  if (!repeat && result !== results[0]) return { title: text.trim() };

  const date = iso(result.date());
  if (!result.start.isCertain("year") && Number(date.slice(0, 4)) > now.getFullYear() && tooFar(date)) {
    return noDate(rolloverWarning(result.text, date));
  }

  // "by friday", "due 12 Oct": the word introducing the date goes with it, and makes it the due
  // date ("Pass by the shop" keeps its "by").
  const lead = source.slice(0, result.index);
  const before = lead.replace(/(^|[\s(])(?:due(?:\s+(?:by|on))?|by)\s*$/i, "$1");
  const title = tidy(before + source.slice(result.index + result.text.length));
  return dated(title, date, before !== lead);
}
