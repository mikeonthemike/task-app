import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import matter from "gray-matter";
import type { AppConfig } from "../config.js";
import { sectionOf } from "./dailyNote.js";
import { cleanTitle } from "./doctor.js";
import type { TaskStore } from "./store.js";
import type { Task } from "./task.js";

/**
 * Read-only scan of the user's own notes (meeting notes, daily notes) for action
 * capture. Skips the task files, the templates folder and anything hidden. A note's
 * `## Actions` section, which the user's meeting template has, is the primary source.
 */
export interface NoteInfo {
  path: string; // relative to the vault
  name: string; // file name without .md
  kind: "daily" | "note";
  modified: string; // local YYYY-MM-DD HH:MM
  date: string | null; // frontmatter `date`, else the daily note's own date
  projects: string | null; // frontmatter `Projects`
  area: string | null;
  actions: string | null; // body of ## Actions, if present and non-empty
  /** Bullets in ## Actions that `capture` would treat as actions (see actionBullets). */
  actionCount: number;
  /** Tasks already captured from this note (their notes say "From: <name>.md" or "From: [[<name>]]"). */
  captured: { id: string; title: string; done: boolean }[];
  body?: string;
}

function templatesFolder(config: AppConfig): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(config.vaultPath, ".obsidian", "templates.json"), "utf8"));
    return raw.folder ? String(raw.folder) : null;
  } catch {
    return null;
  }
}

function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function asString(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}

/** Whether a task's notes say it was captured from the note called `name`. */
export function capturedFrom(t: Task, name: string): boolean {
  return t.notes.some((n) => n === `From: ${name}.md` || n === `From: [[${name}]]` || n === `From: ${name}`);
}

export function scanNotes(
  config: AppConfig,
  tasks: Task[],
  opts: { since?: string; includeBody?: boolean } = {},
): NoteInfo[] {
  const skip = new Set([join(config.vaultPath, config.tasksDir)]);
  const tpl = templatesFolder(config);
  if (tpl) skip.add(join(config.vaultPath, tpl));

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (skip.has(full)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".md")) files.push(full);
    }
  };
  if (existsSync(config.vaultPath)) walk(config.vaultPath);

  const out: NoteInfo[] = [];
  for (const file of files) {
    const modified = localStamp(statSync(file).mtime);
    if (opts.since && modified.slice(0, 10) < opts.since) continue;

    const name = basename(file, ".md");
    const raw = readFileSync(file, "utf8");
    let data: Record<string, unknown> = {};
    let content = raw;
    try {
      ({ data, content } = matter(raw));
    } catch {
      // Malformed frontmatter: treat the whole file as body.
    }
    const daily = /^\d{4}-\d{2}-\d{2}$/.test(name);
    const actions = sectionOf(content, "Actions");

    out.push({
      path: relative(config.vaultPath, file),
      name,
      kind: daily ? "daily" : "note",
      modified,
      date: asString(data.date) ?? (daily ? name : null),
      projects: asString(data.Projects ?? data.projects),
      area: asString(data.area),
      actions: actions || null,
      actionCount: actions ? actionBullets(actions).length : 0,
      captured: tasks.filter((t) => capturedFrom(t, name)).map((t) => ({ id: t.id, title: t.title, done: t.done })),
      ...(opts.includeBody ? { body: content.trim() } : {}),
    });
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * A bullet's own text. Skips: a bullet that's just a label for nested ones
 * ("set up meetings:"), an unfilled template placeholder ("<Insert Actions>"), and a
 * `- [x]` item — some notes use real checkbox syntax here rather than a plain bullet,
 * and one already ticked in the note itself is done, not something to capture. A `- [ ]`
 * one has its checkbox marker stripped and is otherwise treated like a plain bullet.
 */
function actionBullets(actionsBody: string): string[] {
  const out: string[] = [];
  for (const line of actionsBody.split("\n")) {
    let text = /^\s*[-*+]\s+(.*)$/.exec(line)?.[1]?.trim();
    if (!text) continue;

    const checkbox = /^\[([ xX])\]\s*(.*)$/.exec(text);
    if (checkbox) {
      if (checkbox[1].toLowerCase() === "x") continue;
      text = checkbox[2].trim();
    }

    if (!text || text.endsWith(":") || /^<.*>$/.test(text)) continue;
    out.push(text);
  }
  return out;
}

export interface CaptureResult {
  added: { id: string; title: string; from: string }[];
  skipped: { name: string; reason: string }[];
}

/**
 * The `sweep` of the notes world: mechanically pulls every `## Actions` bullet from a
 * note into the Inbox, the same "surface candidates, don't triage" rule already used for
 * Gmail/Slack capture. It only touches a note that has **no** task captured from it yet —
 * once anything has been captured (by this, or by hand with a different wording), a
 * mechanical sweep can't tell a genuinely new bullet from one already captured under
 * different words, so picking up something added later to an engaged note is "process my
 * notes" work for Claude, not this.
 */
export function captureNotesToInbox(config: AppConfig, store: TaskStore, opts: { dryRun?: boolean } = {}): CaptureResult {
  const notes = scanNotes(config, store.all());
  const added: CaptureResult["added"] = [];
  const skipped: CaptureResult["skipped"] = [];

  for (const note of notes) {
    if (!note.actions) continue;
    if (note.captured.length > 0) {
      skipped.push({ name: note.name, reason: `already has ${note.captured.length} task(s) captured from it` });
      continue;
    }
    for (const raw of actionBullets(note.actions)) {
      const title = cleanTitle(raw);
      if (!title) continue;
      if (opts.dryRun) {
        added.push({ id: "(dry-run)", title, from: note.path });
      } else {
        const task = store.add({ title, notes: [`From: ${note.name}.md`] });
        added.push({ id: task.id, title: task.title, from: note.path });
      }
    }
  }
  return { added, skipped };
}
