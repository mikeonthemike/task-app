import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config.js";
import { writeFileAtomic } from "./vault.js";

/**
 * The Obsidian daily note (<vault>/<dailyNotesDir>/YYYY-MM-DD.md) is the master record of
 * each day's plan. task-app owns only the `## <Section>` blocks it's asked to write
 * (Plan, Shutdown, ...); everything else in the note is the user's and is never touched.
 */
export function dailyNotePath(config: AppConfig, date: string): string {
  return join(config.vaultPath, config.dailyNotesDir ?? "", `${date}.md`);
}

interface SectionSpan {
  start: number; // index of the `## Name` line
  end: number; // exclusive: next heading of level ≤ 2, or end of file
}

function findSection(lines: string[], name: string): SectionSpan | null {
  const wanted = name.trim().toLowerCase();
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim().toLowerCase() === wanted);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  return { start, end };
}

/** Body of `## name` within markdown `content`, or null. Shared with the meeting-notes scan. */
export function sectionOf(content: string, name: string): string | null {
  const lines = content.split("\n");
  const span = findSection(lines, name);
  return span ? lines.slice(span.start + 1, span.end).join("\n").trim() : null;
}

const DAILY_NOTE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;

/**
 * The most recent daily note strictly before `date` — and containing `## section`, if
 * given. How the morning run finds the last shutdown across weekends and days off.
 */
export function previousNoteDate(config: AppConfig, date: string, section?: string): string | null {
  const dir = join(config.vaultPath, config.dailyNotesDir ?? "");
  if (!existsSync(dir)) return null;
  const dates = readdirSync(dir)
    .map((f) => DAILY_NOTE_RE.exec(f)?.[1])
    .filter((d): d is string => !!d && d < date)
    .sort()
    .reverse();
  return dates.find((d) => !section || readSection(config, d, section) !== null) ?? null;
}

export function readNote(config: AppConfig, date: string): string | null {
  const path = dailyNotePath(config, date);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Body of `## name` (without the heading), or null if the note or section doesn't exist. */
export function readSection(config: AppConfig, date: string, name: string): string | null {
  const content = readNote(config, date);
  return content === null ? null : sectionOf(content, name);
}

export function listSections(config: AppConfig, date: string): string[] {
  const content = readNote(config, date);
  if (content === null) return [];
  return content
    .split("\n")
    .filter((l) => /^##\s/.test(l))
    .map((l) => l.replace(/^##\s+/, "").trim());
}

/**
 * Replaces the body of `## name`, or appends the section if it isn't there yet. Creates
 * the note if needed. Returns whether it created the file.
 */
export function writeSection(config: AppConfig, date: string, name: string, body: string): { path: string; created: boolean } {
  const path = dailyNotePath(config, date);
  const block = [`## ${name}`, "", ...body.trim().split("\n"), ""];
  const existing = readNote(config, date);

  if (existing === null) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileAtomic(path, block.join("\n"));
    return { path, created: true };
  }

  const lines = existing.split("\n");
  const span = findSection(lines, name);
  if (span) {
    lines.splice(span.start, span.end - span.start, ...block);
  } else {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", ...block);
  }
  writeFileAtomic(path, lines.join("\n"));
  return { path, created: false };
}

/**
 * The task ids proposed under `**Top 3**` in a `## Plan` body, in order. Each numbered item
 * contributes its parenthesised id-like tokens ("(k3Jd9sQa)"), since a title can carry other
 * parentheses; the caller keeps the first that is a real task.
 */
export function proposedTop3(plan: string): string[][] {
  const lines = plan.split("\n");
  const start = lines.findIndex((l) => /^\*\*Top 3\b/i.test(l.trim()));
  if (start === -1) return [];
  const items: string[][] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!m) {
      if (items.length) break;
      continue;
    }
    items.push([...m[1].matchAll(/\(([A-Za-z0-9_-]{4,})\)/g)].map((x) => x[1]));
  }
  return items;
}
