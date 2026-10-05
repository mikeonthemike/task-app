import type { Priority, Task } from "./task.js";

export const PRIORITIES: Priority[] = ["highest", "high", "medium", "low", "lowest"];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---- tiny flag parser: --flag value, --flag (boolean), repeatable flags collected into arrays ----
export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string[]>;
  bool(name: string): boolean;
  one(name: string): string | undefined;
  many(name: string): string[];
}

/** Flags that never take a value, so `add --focus "Call Sam"` keeps "Call Sam" as the title. */
export const BOOLEAN_FLAGS = new Set(["someday", "focus", "force", "json", "fix", "clear", "inbox", "previous", "content", "dry-run", "literal"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(name) && next !== undefined && !next.startsWith("--")) {
        (flags[name] ??= []).push(next);
        i++;
      } else {
        (flags[name] ??= []).push("true");
      }
    } else {
      positional.push(arg);
    }
  }
  return {
    positional,
    flags,
    bool: (name) => name in flags,
    one: (name) => flags[name]?.[flags[name].length - 1],
    many: (name) => flags[name] ?? [],
  };
}

/** Splits a shell-like string into argv tokens, respecting "double quoted" segments. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  return tokens;
}

export function requireDate(value: string, flagName: string): string {
  if (!DATE_RE.test(value)) {
    throw new Error(`--${flagName} must be a date in YYYY-MM-DD format, got "${value}".`);
  }
  return value;
}

export function nullableDate(value: string | undefined, flagName: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  return requireDate(value, flagName);
}

export function parsePriority(value: string | undefined): Priority | undefined {
  if (value === undefined) return undefined;
  if (value === "none") return null;
  if (!PRIORITIES.includes(value as Priority)) {
    throw new Error(`--priority must be one of ${PRIORITIES.join(", ")} (or "none"), got "${value}".`);
  }
  return value as Priority;
}

export function normalizeTag(tag: string): string {
  return tag.startsWith("#") ? tag : `#${tag}`;
}

export function formatTask(t: Task): string {
  const bits = [t.done ? "[x]" : "[ ]", t.title];
  if (t.priority) bits.push(`(${t.priority})`);
  if (t.due) bits.push(`due:${t.due}`);
  if (t.scheduled) bits.push(`sched:${t.scheduled}`);
  if (t.recurrence) bits.push(`🔁 ${t.recurrence}`);
  if (t.project) bits.push(`[project:${t.project}]`);
  else if (t.area) bits.push(`[area:${t.area}]`);
  if (t.tags.length) bits.push(t.tags.join(" "));
  bits.push(`(${t.id})`);
  return bits.join(" ");
}

/**
 * Parses a full "--title ... --due ... --project ..." style edit line into a complete
 * desired state for a task, treating an omitted field as "clear it" rather than
 * "leave unchanged" — this is meant for an editor that's pre-filled with the task's
 * current values, where deleting a flag is how the user expresses clearing it.
 * `--notes` is the exception: it isn't pre-filled and only adds, as on `task-app edit`.
 */
export interface FullEditResult {
  fieldPatch: Pick<Task, "title" | "due" | "scheduled" | "start" | "priority" | "recurrence">;
  dest: { project: string | null; area: string | null; someday: boolean };
  notes: string[];
}

export function parseFullEdit(task: Task, args: ParsedArgs): FullEditResult {
  const fullDate = (value: string | undefined, flagName: string): string | null =>
    value === undefined || value === "none" ? null : requireDate(value, flagName);

  const title = args.one("title") ?? task.title;
  const priorityRaw = args.one("priority");
  const project = args.one("project") ?? null;

  return {
    fieldPatch: {
      title,
      due: fullDate(args.one("due"), "due"),
      scheduled: fullDate(args.one("scheduled"), "scheduled"),
      start: fullDate(args.one("start"), "start"),
      priority: priorityRaw === undefined ? null : (parsePriority(priorityRaw) ?? null),
      recurrence: args.one("recurrence") ?? null,
    },
    dest: {
      project,
      area: project ? null : (args.one("area") ?? null),
      someday: args.bool("someday"),
    },
    notes: args.many("notes"),
  };
}
