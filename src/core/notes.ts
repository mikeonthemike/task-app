import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import matter from "gray-matter";
import type { AppConfig } from "../config.js";
import { sectionOf } from "./dailyNote.js";
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
      captured: tasks.filter((t) => capturedFrom(t, name)).map((t) => ({ id: t.id, title: t.title, done: t.done })),
      ...(opts.includeBody ? { body: content.trim() } : {}),
    });
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}
