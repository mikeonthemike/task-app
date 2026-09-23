import * as chrono from "chrono-node";
import type { NewTaskInput } from "./task.js";

/** Local fallback capture parser (no Claude): pulls a date out with chrono-node, rest is the title. */
export function quickParse(text: string): NewTaskInput {
  const results = chrono.parse(text);
  if (!results.length) return { title: text.trim() };

  const result = results[0];
  const date = result.date();
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  const title = (text.slice(0, result.index) + text.slice(result.index + result.text.length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { title: title || text.trim(), scheduled: iso };
}
