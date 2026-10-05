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
 */
const RULE_RE = new RegExp(
  `\\bevery\\s+(?:(weekday)|(${DAY_RE})|(?:(\\d+|other)\\s+)?(day|week|month|year)s?)\\b(\\s+when\\s+done\\b)?(?:\\s+(?:from|starting(?:\\s+on)?)\\b)?`,
  "i",
);

function takeRule(text: string): { rule: string; rest: string } | null {
  const m = RULE_RE.exec(text);
  if (!m) return null;
  const [, weekday, day, n, unit, whenDone] = m;
  let rule: string;
  if (weekday) rule = "every weekday";
  else if (day) rule = `every ${DAYS[day.toLowerCase()] ?? day.toLowerCase()}`;
  else {
    const count = n?.toLowerCase() === "other" ? 2 : Number(n ?? 1);
    rule = count === 1 ? `every ${unit.toLowerCase()}` : `every ${count} ${unit.toLowerCase()}s`;
  }
  if (whenDone) rule += " when done";
  return { rule, rest: text.slice(0, m.index) + text.slice(m.index + m[0].length) };
}

/** First occurrence on or after today: the next matching day for a weekday rule, today otherwise. */
function firstOccurrence(rule: string, today: string): string {
  return /^every (weekday|[a-z]+day)\b/.test(rule) ? nextDate(rule, addDays(today, -1))! : today;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * "end of the month", "by end of October", "EOW": chrono doesn't know these, so they're read here.
 * A leading "by"/"due" goes with the phrase. The week ends on Friday (the working week).
 */
const END_RE = new RegExp(
  `(^|[\\s(])(?:(?:due\\s+)?by\\s+|due\\s+)?(?:(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?(?:(this|next)\\s+)?(day|week|month|quarter|year|${MONTH_RE})(?:\\s+(\\d{4}))?|(eod|eow|eom|eoy))\\b`,
  "i",
);

const lastOfMonth = (y: number, m: number) => iso(new Date(y, m + 1, 0)); // m is 0-based

function takeEndOf(text: string, now: Date): { date: string; rest: string } | null {
  const m = END_RE.exec(text);
  if (!m) return null;
  const [whole, lead, which, unitRaw, year, short] = m;
  const unit = short ? { eod: "day", eow: "week", eom: "month", eoy: "year" }[short.toLowerCase()]! : unitRaw.toLowerCase();
  const next = which?.toLowerCase() === "next";
  const today = iso(now);
  const y = now.getFullYear();
  const mo = now.getMonth();
  let date: string;
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
    if (!year && date < today) date = lastOfMonth(y + 1, month);
  }
  return { date, rest: text.slice(0, m.index) + lead + text.slice(m.index + whole.length) };
}

const tidy = (s: string) =>
  s
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Local fallback capture parser (no Claude): pulls a date out with chrono-node, rest is the title.
 * Never infers a date in the past: ambiguous phrases resolve forwards ("weekend" = the coming one),
 * and anything still before `now` is ignored, leaving the title untouched.
 *
 * A repeat phrase ("every monday") becomes the recurrence and is taken out before chrono runs, so
 * "monday" isn't read as a one-off date. The first occurrence is an explicit date in the text
 * ("every monday from 12 oct"), else the next matching day (today if it matches).
 *
 * "End of …" phrases (month, week, quarter, year, a named month, EOD/EOW/EOM/EOY) resolve to the
 * last day of that period.
 */
export function quickParse(text: string, now: Date = new Date()): NewTaskInput {
  const today = iso(now);
  const repeat = takeRule(text);
  const source = repeat ? repeat.rest : text;

  const endOf = takeEndOf(source, now);
  if (endOf && endOf.date >= today) {
    return { title: tidy(endOf.rest) || text.trim(), scheduled: endOf.date, ...(repeat && { recurrence: repeat.rule }) };
  }

  const results = chrono.parse(source, now, { forwardDate: true });
  const result = results.find((r) => iso(r.date()) >= today);
  if (!result) {
    if (!repeat) return { title: text.trim() };
    return { title: tidy(source) || text.trim(), recurrence: repeat.rule, scheduled: firstOccurrence(repeat.rule, today) };
  }
  if (!repeat && result !== results[0]) return { title: text.trim() };

  // "by friday", "due 12 Oct": the word introducing the date goes with it ("Pass by the shop" keeps its "by").
  const before = source.slice(0, result.index).replace(/(^|[\s(])(?:due(?:\s+(?:by|on))?|by)\s*$/i, "$1");
  const title = tidy(before + source.slice(result.index + result.text.length));
  return { title: title || text.trim(), scheduled: iso(result.date()), ...(repeat && { recurrence: repeat.rule }) };
}
