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
 */
export function quickParse(text: string, now: Date = new Date()): NewTaskInput {
  const today = iso(now);
  const repeat = takeRule(text);
  const source = repeat ? repeat.rest : text;

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
