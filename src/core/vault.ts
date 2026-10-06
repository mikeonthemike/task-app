import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import matter from "gray-matter";
import { nanoid } from "nanoid";
import type { AppConfig } from "../config.js";
import type { NewTaskInput, Priority, Task } from "./task.js";
import { slugify, todayStr } from "./task.js";

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

const TAG_RE = /#[A-Za-z0-9_/-]+/g;
const CHECKBOX_RE = /^(\s*)-\s\[([ xX])\]\s+(.*)$/;

type FieldKind = keyof typeof DATE_FIELD_EMOJI | "id" | "recurrence" | "priority";

/**
 * One field at the very end of a line. Like the Tasks plugin, parseLine peels these off
 * the end one at a time, so an emoji field that sits inside the description (with plain
 * text after it) stays part of the title rather than overriding the real one.
 */
const TRAILING_FIELD_RES: [FieldKind, RegExp][] = [
  ...Object.entries(DATE_FIELD_EMOJI).map(
    ([field, emoji]) => [field as FieldKind, new RegExp(`${emoji}\\uFE0F?\\s*(\\d{4}-\\d{2}-\\d{2})$`, "u")] as [FieldKind, RegExp],
  ),
  ["id", /🆔\uFE0F?\s*(\S+)$/u],
  ["recurrence", /🔁\uFE0F?\s*([^➕🛫⏳📅✅🔁🔺⏫🔼🔽⏬🆔#]+)$/u],
  ["priority", /([🔺⏫🔼🔽⏬])\uFE0F?$/u],
];
const TRAILING_TAG_RE = /(?:^|\s)(#[A-Za-z0-9_/-]+)$/;
const TRAILING_BLOCK_LINK_RE = /\s+(\^[A-Za-z0-9-]+)$/;

/** A Tasks emoji field (date, recurrence or id) inside a title, where Obsidian won't read it as one. */
const TITLE_FIELD_RE =
  /[➕🛫⏳📅✅]\uFE0F?\s*\d{4}-\d{2}-\d{2}|🆔\uFE0F?\s*\S+|🔁\uFE0F?\s*[^\s➕🛫⏳📅✅🔁🆔#]+(?:\s+[^\s➕🛫⏳📅✅🔁🆔#]+)*/gu;

/** The Tasks emoji fields written inside a title (`➕ 2026-10-12`), in order. */
export function fieldsInTitle(title: string): string[] {
  return title.match(TITLE_FIELD_RE) ?? [];
}

/** The title with any emoji fields removed. */
export function stripTitleFields(title: string): string {
  return title.replace(TITLE_FIELD_RE, "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Splits a line's text into its description and the fields trailing it. Stops at the first
 * field kind it sees twice, so a duplicate stays visible in the title for `doctor` instead of
 * one copy silently winning.
 */
function splitTrailingFields(text: string): { description: string; fields: Partial<Record<FieldKind, string>> } {
  const fields: Partial<Record<FieldKind, string>> = {};
  let rest = text.trimEnd();
  const blockLink = TRAILING_BLOCK_LINK_RE.exec(rest);
  if (blockLink) rest = rest.slice(0, blockLink.index).trimEnd();

  peel: while (rest.length) {
    const tag = TRAILING_TAG_RE.exec(rest);
    if (tag) {
      rest = rest.slice(0, tag.index).trimEnd();
      continue;
    }
    for (const [kind, re] of TRAILING_FIELD_RES) {
      const m = re.exec(rest);
      if (!m) continue;
      if (kind in fields) break peel;
      fields[kind] = m[1].trim();
      rest = rest.slice(0, m.index).trimEnd();
      continue peel;
    }
    break;
  }
  return { description: blockLink ? `${rest} ${blockLink[1]}` : rest, fields };
}

function slugToTitle(slug: string): string {
  return slug
    .split(/[-_]/g)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Writes via a temp file + rename so Obsidian (or a sync client) never observes a
 * half-written file, and a crash mid-write can't truncate a task list.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = `${filePath}.task-app-${process.pid}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, filePath);
}

export function titleToSlug(title: string): string {
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

  let project: string | null = projTag
    ? nameForSlug(join(tasksRoot, "Projects"), projTag.slice("#project/".length))
    : null;
  let area: string | null = areaTagFromLine
    ? nameForSlug(join(tasksRoot, "Areas"), areaTagFromLine.slice("#area/".length))
    : null;

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

/** Maps a tag slug back to the real project/area file name (`crm` → `CRM`), falling back to title case. */
function nameForSlug(dir: string, slug: string): string {
  const existing = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
    : [];
  return existing.find((name) => titleToSlug(name) === slug.toLowerCase()) ?? slugToTitle(slug);
}

/** The project/area a file's location implies on its own, without any tags on the line. */
function impliedByFile(filePath: string): { project: string | null; area: string | null } {
  const name = basename(filePath).replace(/\.md$/, "");
  const parent = basename(dirname(filePath));
  if (parent === "Projects") {
    const fmArea = readFrontmatter(filePath)?.area;
    return { project: name, area: fmArea ? String(fmArea) : null };
  }
  if (parent === "Areas") return { project: null, area: name };
  return { project: null, area: null };
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

  // Tags count wherever they are on the line; emoji fields only in the trailing run.
  const tags: string[] = rest.match(TAG_RE) ?? [];
  const { description, fields } = splitTrailingFields(rest);

  let title = description;
  for (const tag of tags) title = title.split(tag).join("");
  title = title.replace(/\s{2,}/g, " ").trim();

  const someday = tags.includes("#someday") || filePath === join(tasksRoot, "Someday.md");
  const { project, area } = deriveProjectArea(tasksRoot, filePath, tags);

  return {
    id: fields.id ?? nanoid(8),
    title,
    done,
    doneDate: fields.done ?? null,
    priority: fields.priority ? EMOJI_TO_PRIORITY[fields.priority] : null,
    scheduled: fields.scheduled ?? null,
    due: fields.due ?? null,
    start: fields.start ?? null,
    created: fields.created ?? null,
    recurrence: fields.recurrence ?? null,
    tags: tags.filter((t) => !t.startsWith("#project/") && !t.startsWith("#area/")),
    project,
    area,
    someday,
    notes: [],
    location: { file: filePath, lineIndex },
  };
}

export interface ScanOptions {
  /**
   * Write freshly assigned 🆔 fields back to their files (the default). A watcher that rescans
   * on every Obsidian autosave passes false, so it never rewrites a line the user is still
   * typing; those tasks come back with `idPending` set and an id that is only good for this scan.
   */
  persistIds?: boolean;
}

export function scanVault(config: AppConfig, { persistIds = true }: ScanOptions = {}): Task[] {
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
      if (lineId(lines[i]) === undefined) {
        if (!persistIds) {
          // Stable across rescans (unlike parseLine's random id) so a UI can still act on it.
          const key = `${relative(tasksRoot, file)}\n${task.title}`;
          task.id = `~${createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
          task.idPending = true;
          continue;
        }
        lines[i] = serializeTaskLine(task);
        idsWereAdded = true;
      }
    }

    if (idsWereAdded) writeFileAtomic(file, lines.join("\n"));
  }
  return tasks;
}

/**
 * Serializes a task for the file in task.location.file. Project/area normally come from
 * where the file lives, so they're kept out of task.tags — but when the file doesn't
 * imply them (Inbox.md, Logbook.md), they're written back as #project/… / #area/… tags,
 * otherwise rewriting such a line would silently drop its project/area.
 */
export function serializeTaskLine(task: Task): string {
  const parts: string[] = [`- [${task.done ? "x" : " "}] ${task.title}`];

  const tags = [...task.tags];
  const implied = impliedByFile(task.location.file);
  if (task.project && task.project !== implied.project && !tags.some((t) => t.startsWith("#project/"))) {
    tags.push(`#project/${titleToSlug(task.project)}`);
  }
  if (task.area && task.area !== implied.area && !tags.some((t) => t.startsWith("#area/"))) {
    tags.push(`#area/${titleToSlug(task.area)}`);
  }
  for (const tag of tags) parts.push(tag);
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
  writeFileAtomic(filePath, lines.join("\n"));
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

/** The 🆔 field of a task line, if it has one (a 🆔 inside the title doesn't count). */
function lineId(line: string): string | undefined {
  const m = CHECKBOX_RE.exec(line);
  return m ? splitTrailingFields(m[3]).fields.id : undefined;
}

function lineHasId(line: string | undefined, id: string): boolean {
  return line !== undefined && lineId(line) === id;
}

/**
 * Finds the task's current line index. A Task's stored lineIndex goes stale if the
 * file changed since it was scanned (edited in Obsidian while the TUI is open, another
 * command ran, etc.) — so trust it only if that line still carries the task's 🆔, and
 * otherwise search the file by id. Refuses rather than guessing, so a stale index can
 * never clobber some other task's line.
 */
function locateLine(task: Task, lines: string[]): number {
  if (lineHasId(lines[task.location.lineIndex], task.id)) return task.location.lineIndex;
  const matches = lines.flatMap((l, i) => (lineHasId(l, task.id) ? [i] : []));
  if (matches.length === 1) return matches[0];
  if (!matches.length) {
    throw new Error(`Task ${task.id} ("${task.title}") is no longer in ${task.location.file} — re-run the command.`);
  }
  throw new Error(`Task id ${task.id} appears ${matches.length} times in ${task.location.file} — run "task-app doctor --fix".`);
}

/**
 * Rewrites a task's own line in place (used for completing, rescheduling, editing).
 * Pass `currentId` when the patch changes the task's id, so the old line can be found.
 */
export function updateTask(task: Task, currentId: string = task.id): Task {
  const lines = readFileSync(task.location.file, "utf8").split("\n");
  const index = locateLine({ ...task, id: currentId }, lines);
  lines[index] = serializeTaskLine(task);
  writeFileAtomic(task.location.file, lines.join("\n"));
  return { ...task, location: { ...task.location, lineIndex: index } };
}

export function completeTask(task: Task): Task {
  return updateTask({ ...task, done: true, doneDate: todayStr() });
}

/** Inserts `newTask` (+ notes) on the line above `anchor`, as the Tasks plugin does for a recurrence. */
export function insertAbove(anchor: Task, newTask: Task): Task {
  const lines = readFileSync(anchor.location.file, "utf8").split("\n");
  const index = locateLine(anchor, lines);
  const indent = /^(\s*)/.exec(lines[index])![1];
  const placed: Task = { ...newTask, location: { file: anchor.location.file, lineIndex: index } };
  lines.splice(index, 0, indent + serializeTaskLine(placed), ...newTask.notes.map((n) => `${indent}  ${n}`));
  writeFileAtomic(anchor.location.file, lines.join("\n"));
  return placed;
}

/** Appends note lines after a task's existing notes, at the same indent the scan reads them from. */
export function appendNotes(task: Task, notes: string[]): Task {
  const lines = readFileSync(task.location.file, "utf8").split("\n");
  const index = locateLine(task, lines);
  const indent = /^(\s*)/.exec(lines[index])![1];
  let end = index + 1;
  while (end < lines.length && /^\s{2,}\S/.test(lines[end]) && !CHECKBOX_RE.test(lines[end])) end++;
  lines.splice(end, 0, ...notes.map((n) => `${indent}  ${n}`));
  writeFileAtomic(task.location.file, lines.join("\n"));
  return { ...task, notes: [...task.notes, ...notes], location: { ...task.location, lineIndex: index } };
}

/** Removes a task's line (and its trailing note lines) from its file entirely. */
export function deleteTaskLine(task: Task): void {
  const lines = readFileSync(task.location.file, "utf8").split("\n");
  const index = locateLine(task, lines);
  let end = index + 1;
  while (end < lines.length && /^\s{2,}\S/.test(lines[end]) && !CHECKBOX_RE.test(lines[end])) end++;
  lines.splice(index, end - index);
  writeFileAtomic(task.location.file, lines.join("\n"));
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
  const moved: Task = { ...task, project, area, someday, location: { file: targetFile, lineIndex: -1 } };
  const serialized = serializeTaskLine(moved);

  // Delete first when moving within the same file, since the append would shift indexes.
  if (targetFile === task.location.file) deleteTaskLine(task);
  const newIndex = appendSerializedLine(targetFile, project ?? area ?? "Inbox", serialized, task.notes);
  // Otherwise append first: a crash in between leaves a duplicate that `doctor` can
  // merge, never a lost task.
  if (targetFile !== task.location.file) deleteTaskLine(task);

  return { ...moved, location: { file: targetFile, lineIndex: newIndex } };
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

  // Write into the Logbook first, then delete the originals — a crash in between
  // leaves a duplicate (which the upsert below and `doctor` both handle), never a
  // lost task.
  const moved: Task[] = [];
  for (const original of [...toMove].sort((a, b) => (a.doneDate ?? "").localeCompare(b.doneDate ?? ""))) {
    // Once relocated to Logbook.md, project/area can no longer be derived from file
    // location — serializing for the Logbook bakes them in as tags so history isn't lost.
    // A project's goal comes from its frontmatter, so bake that in too — metrics over the
    // Logbook then survive the project being relinked or deleted.
    const tags = [...original.tags];
    const goal = original.project ? readFrontmatter(join(tasksRoot, "Projects", `${original.project}.md`))?.goal : null;
    if (goal && !tags.some((tag) => tag.startsWith("#goal/"))) tags.push(`#goal/${slugify(String(goal))}`);
    const t: Task = { ...original, tags, location: { file: logbookPath, lineIndex: -1 } };
    const newIndex = upsertIntoFile(logbookPath, "Logbook", t);
    moved.push({ ...t, location: { file: logbookPath, lineIndex: newIndex } });
  }

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
  return moved;
}

/**
 * Appends a task to a file — unless a line with the same 🆔 is already there (e.g. a
 * previous interrupted sweep), in which case that line is replaced instead. This is
 * what makes sweeping idempotent. Returns the task's line index.
 */
function upsertIntoFile(filePath: string, defaultHeading: string, task: Task): number {
  if (existsSync(filePath)) {
    const lines = readFileSync(filePath, "utf8").split("\n");
    const index = lines.findIndex((l) => lineHasId(l, task.id));
    if (index !== -1) {
      lines[index] = serializeTaskLine(task);
      writeFileAtomic(filePath, lines.join("\n"));
      return index;
    }
  }
  return appendSerializedLine(filePath, defaultHeading, serializeTaskLine(task), task.notes);
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
