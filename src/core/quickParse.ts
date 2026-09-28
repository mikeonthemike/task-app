import * as chrono from "chrono-node";
import type { NewTaskInput } from "./task.js";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Local fallback capture parser (no Claude): pulls a date out with chrono-node, rest is the title.
 * Never infers a date in the past: ambiguous phrases resolve forwards ("weekend" = the coming one),
 * and anything still before `now` is ignored, leaving the title untouched.
 */
export function quickParse(text: string, now: Date = new Date()): NewTaskInput {
  const results = chrono.parse(text, now, { forwardDate: true });
  if (!results.length) return { title: text.trim() };

  const result = results[0];
  const scheduled = iso(result.date());
  if (scheduled < iso(now)) return { title: text.trim() };

  const title = (text.slice(0, result.index) + text.slice(result.index + result.text.length))
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { title: title || text.trim(), scheduled };
}
