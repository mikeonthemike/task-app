import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import type { AppConfig } from "../config.js";
import type { NewTaskInput, Priority, Task } from "./task.js";
import { todayStr } from "./task.js";

const PRIORITY_TO_EMOJI: Record<Exclude<Priority, null>, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};
const EMOJI_TO_PRIORITY: Record<string, Priority> = Object.fromEntries(
  Object.entries(PRIORITY_TO_EMOJI).map(([k, v]) => [v, k as Priority]),
);

const DATE_FIELD_EMOJI = {
  created: "➕",
  start: "🛫",
  scheduled: "⏳",
  due: "📅",
  done: "✅",
} as const;

const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const TAG_RE = /#[A-Za-z0-9_/-]+/g;
const ID_RE = /🆔\s*(\S+)/;
const RECURRENCE_RE = /🔁\s*([^➕🛫⏳📅✅🔺⏫🔼🔽⏬🆔#]+)/;
const CHECKBOX_RE = /^(\s*)-\s\[([ xX])\]\s+(.*)$/;

function slugToTitle(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function titleToSlug(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-");
}

function findAllMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findAllMarkdownFiles(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function deriveProjectArea(
  tasksRoot: string,
  filePath: string,
  tags: string[],
): { project: string | null; area: string | null } {
  const projTag = tags.find((t) => t.startsWith("#project/"));
  const areaTagFromLine = tags.find((t) => t.startsWith("#area/"));

  const rel = relative(tasksRoot, filePath);
  const parts = rel.split(sep);

  let project: string | null = projTag ? slugToTitle(projTag.slice("#project/".length)) : null;
  let area: string | null = areaTagFromLine ? slugToTitle(areaTagFromLine.slice("#area/".length)) : null;

  if (!project && parts[0] === "Projects" && parts.length >= 2) {
    project = parts[parts.length - 1].replace(/\.md$/, "");
  }
  if (!area && parts[0] === "Areas" && parts.length >= 2) {
    area = parts[parts.length - 1].replace(/\.md$/, "");
  }
  // A project file's frontmatter can declare its parent area: `area: Work`
  if (!area && parts[0] === "Projects") {
    const fm = readFrontmatter(filePath);
    if (fm?.area) area = String(fm.area);
  }
  return { project, area };
}

function readFrontmatter(filePath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    return parsed.data ?? null;
  } catch {
    return null;
  }
}

function parseLine(
  line: string,
  filePath: string,
  lineIndex: number,
  tasksRoot: string,
): Task | null {
  const m = CHECKBOX_RE.exec(line);
  if (!m) return null;
  const [, , checkMark, rest] = m;
  const done = checkMark.toLowerCase() === "x";

  const tags: string[] = rest.match(TAG_RE) ?? [];
  const idMatch = ID_RE.exec(rest);
  const recurMatch = RECURRENCE_RE.exec(rest);
  const priorityEmoji = Object.keys(EMOJI_TO_PRIORITY).find((e) => rest.includes(e));

  const dates: Record<string, string | null> = {
    created: null,
    start: null,
    scheduled: null,
    due: null,
    done: null,
  };
  let title = rest;

  for (const [field, emoji] of Object.entries(DATE_FIELD_EMOJI)) {
    const idx = title.indexOf(emoji);
    if (idx !== -1) {
      const after = title.slice(idx + emoji.length);
      const dateMatch = DATE_RE.exec(after);
      if (dateMatch) {
        dates[field] = dateMatch[1];
        title = title.slice(0, idx) + after.slice(dateMatch.index + dateMatch[1].length);
      }
    }
  }

  if (idMatch) title = title.replace(ID_RE, "");
  if (recurMatch) title = title.replace(RECURRENCE_RE, "");
  if (priorityEmoji) title = title.split(priorityEmoji).join("");
  for (const tag of tags) title = title.split(tag).join("");

  title = title.replace(/\s{2,}/g, " ").trim();

  const someday = tags.includes("#someday") || filePath === join(tasksRoot, "Someday.md");
  const { project, area } = deriveProjectArea(tasksRoot, filePath, tags);

  return {
    id: idMatch?.[1] ?? nanoid(8),
    title,
    done,
    doneDate: dates.done,
    priority: priorityEmoji ? EMOJI_TO_PRIORITY[priorityEmoji] : null,
    scheduled: dates.scheduled,
    due: dates.due,
    start: dates.start,
    created: dates.created,
    recurrence: recurMatch ? recurMatch[1].trim() : null,
    tags: tags.filter((t) => !t.startsWith("#project/") && !t.startsWith("#area/")),
    project,
    area,
    someday,
    notes: [],
    location: { file: filePath, lineIndex },
  };
}

export function scanVault(config: AppConfig): Task[] {
  const tasksRoot = join(config.vaultPath, config.tasksDir);
  const files = findAllMarkdownFiles(tasksRoot);
  const tasks: Task[] = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    let idsWereAdded = false;

    for (let i = 0; i < lines.length; i++) {
      const task = parseLine(lines[i], file, i, tasksRoot);
      if (!task) continue;
      // Collect immediately-following indented non-checkbox lines as notes.
      let j = i + 1;
      while (j < lines.length && /^\s{2,}\S/.test(lines[j]) && !CHECKBOX_RE.test(lines[j])) {
        task.notes.push(lines[j].trim());
        j++;
      }
      tasks.push(task);

      // A task typed directly in Obsidian has no 🆔 field yet — parseLine hands it
      // a fresh id, but that's only stable once it's actually written back to the
      // file (otherwise it'd be re-randomized on every scan).
      if (!ID_RE.test(lines[i])) {
        lines[i] = serializeTaskLine(task);
        idsWereAdded = true;
      }
    }

    if (idsWereAdded) writeFileSync(file, lines.join("\n"), "utf8");
  }
  return tasks;
}

export function serializeTaskLine(task: Task): string {
  const parts: string[] = [`- [${task.done ? "x" : " "}] ${task.title}`];

  for (const tag of task.tags) parts.push(tag);
  if (task.priority) parts.push(PRIORITY_TO_EMOJI[task.priority]);
  if (task.recurrence) parts.push(`🔁 ${task.recurrence}`);
  if (task.start) parts.push(`🛫 ${task.start}`);
  if (task.scheduled) parts.push(`⏳ ${task.scheduled}`);
  if (task.due) parts.push(`📅 ${task.due}`);
  if (task.done && task.doneDate) parts.push(`✅ ${task.doneDate}`);
  if (task.created) parts.push(`➕ ${task.created}`);
  parts.push(`🆔 ${task.id}`);

  return parts.join(" ");
}

function ensureFileExists(filePath: string, heading: string, frontmatter?: Record<string, unknown>): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  const fm = frontmatter ? matter.stringify("", frontmatter) : "";
  writeFileSync(filePath, `${fm}# ${heading}\n\n`, "utf8");
}

/** Resolves (and creates if needed) the target vault file for a new task's project/area/someday combination. */
export function resolveTargetFile(config: AppConfig, input: NewTaskInput): string {
  const tasksRoot = join(config.vaultPath, config.tasksDir);
  if (input.someday) {
    const p = join(tasksRoot, "Someday.md");
    ensureFileExists(p, "Someday");
    return p;
  }
  if (input.project) {
    const p = join(tasksRoot, "Projects", `${input.project}.md`);
    ensureFileExists(p, input.project, input.area ? { area: input.area } : undefined);
    return p;
  }
  if (input.area) {
    const p = join(tasksRoot, "Areas", `${input.area}.md`);
    ensureFileExists(p, input.area);
    return p;
  }
  const p = join(tasksRoot, "Inbox.md");
  ensureFileExists(p, "Inbox");
  return p;
}

/** Appends an already-serialized task line (+ notes) to a file, creating it if needed. Returns the new line index. */
function appendSerializedLine(filePath: string, defaultHeading: string, line: string, notes: string[]): number {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = existing.trim().length ? existing.split("\n") : [`# ${defaultHeading}`];
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  // Separate the first task from the heading/frontmatter with one blank line;
  // subsequent tasks are appended directly under the previous one.
  if (!lines.some((l) => CHECKBOX_RE.test(l))) lines.push("");

  const newIndex = lines.length;
  lines.push(line);
  for (const note of notes) lines.push(`  ${note}`);
  lines.push("");

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, lines.join("\n"), "utf8");
  return newIndex;
}

export function appendTask(config: AppConfig, input: NewTaskInput, targetFile?: string): Task {
  const filePath = targetFile ?? resolveTargetFile(config, input);
  const task: Task = {
    id: nanoid(8),
    title: input.title.trim(),
    done: false,
    doneDate: null,
    priority: input.priority ?? null,
    scheduled: input.scheduled ?? null,
    due: input.due ?? null,
    start: input.start ?? null,
    created: todayStr(),
    recurrence: input.recurrence ?? null,
    tags: input.tags ?? [],
    project: input.project ?? null,
    area: input.area ?? null,
    someday: input.someday ?? false,
    notes: input.notes ?? [],
    location: { file: filePath, lineIndex: -1 },
  };

  task.location.lineIndex = appendSerializedLine(
    filePath,
    input.project ?? input.area ?? "Inbox",
    serializeTaskLine(task),
    task.notes,
  );
  return task;
}

/** Rewrites a task's own line in place (used for completing, rescheduling, editing). */
export function updateTask(task: Task): void {
  const lines = readFileSync(task.location.file, "utf8").split("\n");
  lines[task.location.lineIndex] = serializeTaskLine(task);
  writeFileSync(task.location.file, lines.join("\n"), "utf8");
}

export function completeTask(task: Task): Task {
  const updated: Task = { ...task, done: true, doneDate: todayStr() };
  updateTask(updated);
  return updated;
}

/** Removes a task's line (and its trailing note lines) from its file entirely. */
export function deleteTaskLine(task: Task): void {
  const lines = readFileSync(task.location.file, "utf8").split("\n");
  let end = task.location.lineIndex + 1;
  while (end < lines.length && /^\s{2,}\S/.test(lines[end]) && !CHECKBOX_RE.test(lines[end])) end++;
  lines.splice(task.location.lineIndex, end - task.location.lineIndex);
  writeFileSync(task.location.file, lines.join("\n"), "utf8");
}

/** Moves a task to a different project/area/someday destination, preserving its id, dates, and notes. */
export function moveTask(
  config: AppConfig,
  task: Task,
  dest: { project?: string | null; area?: string | null; someday?: boolean },
): Task {
  const project = dest.project ?? null;
  const area = dest.area ?? null;
  const someday = dest.someday ?? false;
  const targetFile = resolveTargetFile(config, { title: task.title, project, area, someday });
  const serialized = serializeTaskLine(task);

  deleteTaskLine(task);
  const newIndex = appendSerializedLine(targetFile, project ?? area ?? "Inbox", serialized, task.notes);

  return { ...task, project, area, someday, location: { file: targetFile, lineIndex: newIndex } };
}

/**
 * Relocates every completed task (wherever it lives) into a single Tasks/Logbook.md,
 * so Project/Area files don't accumulate old `[x]` clutter. Doesn't change what counts
 * as "done" — the app's views already read that from the task itself, not its file.
 */
export function sweepCompletedTasks(config: AppConfig): Task[] {
  const tasksRoot = join(config.vaultPath, config.tasksDir);
  const logbookPath = join(tasksRoot, "Logbook.md");

  const toMove = scanVault(config).filter((t) => t.done && t.location.file !== logbookPath);

  // Delete bottom-to-top per file so removing one line never invalidates another
  // still-pending deletion's lineIndex within the same file.
  const byFile = new Map<string, Task[]>();
  for (const t of toMove) {
    const list = byFile.get(t.location.file) ?? [];
    list.push(t);
    byFile.set(t.location.file, list);
  }
  for (const fileTasks of byFile.values()) {
    for (const t of [...fileTasks].sort((a, b) => b.location.lineIndex - a.location.lineIndex)) {
      deleteTaskLine(t);
    }
  }

  const moved: Task[] = [];
  for (const original of toMove.sort((a, b) => (a.doneDate ?? "").localeCompare(b.doneDate ?? ""))) {
    // Once relocated to Logbook.md, project/area can no longer be derived from file
    // location — bake them in as tags so history isn't lost.
    const tags = [...original.tags];
    if (original.project && !tags.some((tag) => tag.startsWith("#project/"))) {
      tags.push(`#project/${titleToSlug(original.project)}`);
    }
    if (original.area && !tags.some((tag) => tag.startsWith("#area/"))) {
      tags.push(`#area/${titleToSlug(original.area)}`);
    }
    const t = { ...original, tags };

    const newIndex = appendSerializedLine(logbookPath, "Logbook", serializeTaskLine(t), t.notes);
    moved.push({ ...t, location: { file: logbookPath, lineIndex: newIndex } });
  }
  return moved;
}

export function listProjectFiles(config: AppConfig): string[] {
  const dir = join(config.vaultPath, config.tasksDir, "Projects");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}

export function listAreaFiles(config: AppConfig): string[] {
  const dir = join(config.vaultPath, config.tasksDir, "Areas");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
}
