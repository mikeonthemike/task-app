export type Priority = "highest" | "high" | "medium" | "low" | "lowest" | null;

export interface Task {
  /** Stable short id, generated once and persisted as a 🆔 field in the markdown line. */
  id: string;
  title: string;
  done: boolean;
  doneDate: string | null; // YYYY-MM-DD
  priority: Priority;
  /** "Scheduled" date == Things' notion of when a task should appear/start (⏳). */
  scheduled: string | null;
  /** Hard due date (📅). */
  due: string | null;
  start: string | null; // 🛫
  created: string | null; // ➕
  recurrence: string | null; // 🔁 <rule text>
  tags: string[]; // includes #project/x and #area/x style tags found inline, minus the ones used to derive project/area below
  /** Derived from the vault file the task lives in. */
  project: string | null;
  area: string | null;
  someday: boolean;
  notes: string[]; // indented lines directly following the task line
  /** Where this task physically lives, so edits can be written back. */
  location: {
    file: string; // absolute path
    lineIndex: number; // 0-based line number in that file
  };
}

export interface NewTaskInput {
  title: string;
  priority?: Priority;
  scheduled?: string | null;
  due?: string | null;
  start?: string | null;
  recurrence?: string | null;
  tags?: string[];
  project?: string | null;
  area?: string | null;
  someday?: boolean;
  notes?: string[];
}

export function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr === todayStr();
}

export function isPastOrToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr <= todayStr();
}

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Tag-safe slug: "Pat O'Neil" → "pat-o-neil". */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
