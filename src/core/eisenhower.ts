import { relative } from "node:path";
import { waitingOn } from "./meta.js";
import { addDays, type Priority, type Task } from "./task.js";

/**
 * The Eisenhower matrix, worked out exactly as the vault's `Tasks/Eisenhower.md` query note does
 * it, so the widget and Obsidian always agree. Change one, change the other: the note's queries
 * are plain Tasks filters (JavaScript is off in the vault), so they can't share this code.
 *
 *   urgent    = due within URGENT_DAYS days, overdue included. Only 📅 counts: a task past its
 *               ⏳ scheduled date with no due date is "not urgent" here, though Today shows it.
 *   important = priority above normal (🔼 ⏫ 🔺), or a direct #goal/ tag. A goal inherited from
 *               the task's project doesn't count, because the note can't read project frontmatter.
 *
 * Open tasks outside Someday that have started (no 🛫, or 🛫 today or earlier) are sorted into
 * the four quadrants; anything waiting on someone gets its own list instead.
 */
export const URGENT_DAYS = 3;

export interface Eisenhower {
  /** Important and urgent. */
  doNow: Task[];
  /** Important, not urgent. */
  schedule: Task[];
  /** Urgent, not important. */
  delegate: Task[];
  /** Neither. */
  question: Task[];
  /** Open tasks waiting on someone, follow-ups soonest first. */
  waiting: Task[];
}

const PRIORITY_RANK: Record<NonNullable<Priority> | "normal", number> = {
  highest: 0,
  high: 1,
  medium: 2,
  normal: 3,
  low: 4,
  lowest: 5,
};

const rank = (t: Task) => PRIORITY_RANK[t.priority ?? "normal"];
/** Tasks' `sort by due`/`sort by scheduled`: earliest first, undated last. */
const byDate = (key: "due" | "scheduled") => (a: Task, b: Task) => (a[key] ?? "9999").localeCompare(b[key] ?? "9999");
const byPriority = (a: Task, b: Task) => rank(a) - rank(b);
const then =
  (...cmps: ((a: Task, b: Task) => number)[]) =>
  (a: Task, b: Task) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r) return r;
    }
    return 0;
  };

export function isImportant(t: Task): boolean {
  return rank(t) < PRIORITY_RANK.normal || t.tags.some((x) => x.startsWith("#goal/"));
}

export function isUrgent(t: Task, today: string): boolean {
  return !!t.due && t.due <= addDays(today, URGENT_DAYS);
}

export function eisenhower(tasks: Task[], today: string, vaultPath: string): Eisenhower {
  const open = tasks.filter((t) => !t.done);
  // `path does not include Someday` and `starts before tomorrow` (an unset 🛫 always matches).
  const live = open.filter((t) => !relative(vaultPath, t.location.file).includes("Someday") && (!t.start || t.start <= today));
  const sorted = live.filter((t) => waitingOn(t) === null);
  const quadrant = (important: boolean, urgent: boolean) =>
    sorted.filter((t) => isImportant(t) === important && isUrgent(t, today) === urgent);

  return {
    doNow: quadrant(true, true).sort(then(byDate("due"), byPriority)),
    schedule: quadrant(true, false).sort(then(byPriority, byDate("due"))),
    delegate: quadrant(false, true).sort(byDate("due")),
    question: quadrant(false, false).sort(byPriority),
    waiting: open.filter((t) => waitingOn(t) !== null).sort(byDate("scheduled")),
  };
}
