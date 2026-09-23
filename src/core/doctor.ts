import { basename, join, relative } from "node:path";
import { nanoid } from "nanoid";
import type { AppConfig } from "../config.js";
import type { Task } from "./task.js";
import { todayStr } from "./task.js";
import { deleteTaskLine, listAreaFiles, listProjectFiles, moveTask, scanVault, updateTask } from "./vault.js";

export type IssueKind = "duplicate-id" | "missing-done-date" | "title-junk" | "misfiled-inbox";

export interface Issue {
  kind: IssueKind;
  id: string;
  file: string; // relative to the tasks folder
  message: string;
  /** What --fix would do; absent if the issue needs a human decision. */
  fix?: string;
}

interface Diagnosis extends Issue {
  apply?: () => void;
}

/**
 * CLI output from formatTask (`[area:Work]`) or one of task-app's own flags
 * (`--project`) that ended up inside a title. Limited to our flag names so a real
 * title like "document the --verbose option" is left alone.
 */
const TITLE_JUNK_RE =
  /\s*\[(?:project|area):[^\]]*\]|(?:^|\s)--(?:project|area|due|scheduled|start|priority|recurrence|tag|notes|someday|inbox|title|goal|focus|waiting|followup|est|force)(?=\s|$)/gi;

export function cleanTitle(title: string): string {
  return title.replace(TITLE_JUNK_RE, "").replace(/\s{2,}/g, " ").trim();
}

function normalizedTitle(t: Task): string {
  return cleanTitle(t.title).toLowerCase();
}

function diagnose(config: AppConfig): Diagnosis[] {
  const tasksRoot = join(config.vaultPath, config.tasksDir);
  const rel = (t: Task) => relative(tasksRoot, t.location.file);
  const tasks = scanVault(config);
  const out: Diagnosis[] = [];

  // --- duplicate ids ---
  const byId = new Map<string, Task[]>();
  for (const t of tasks) byId.set(t.id, [...(byId.get(t.id) ?? []), t]);
  for (const [id, copies] of byId) {
    if (copies.length < 2) continue;
    const where = copies.map((c) => `${rel(c)}:${c.location.lineIndex + 1}`).join(", ");
    const sameTask = new Set(copies.map(normalizedTitle)).size === 1;

    if (sameTask) {
      // Same task written twice (e.g. an interrupted sweep): keep the copy with the most
      // notes, fold in any fields only the other copies have, and drop the rest.
      const keep = [...copies].sort((a, b) => b.notes.length - a.notes.length)[0];
      const merged: Task = {
        ...keep,
        done: copies.some((c) => c.done),
        doneDate: keep.doneDate ?? copies.find((c) => c.doneDate)?.doneDate ?? null,
        tags: [...new Set(copies.flatMap((c) => c.tags))],
      };
      out.push({
        kind: "duplicate-id",
        id,
        file: rel(keep),
        message: `"${keep.title}" is written ${copies.length} times (${where}).`,
        fix: `Merge into one line at ${rel(keep)}:${keep.location.lineIndex + 1}.`,
        apply: () => {
          // Bottom-to-top so deleting one copy never shifts another copy's line.
          const drop = copies
            .filter((c) => c !== keep)
            .sort((a, b) => b.location.lineIndex - a.location.lineIndex);
          updateTask(merged);
          for (const c of drop) deleteTaskLine(c);
        },
      });
    } else {
      // Different tasks sharing an id (e.g. a line duplicated in Obsidian and then edited).
      const [, ...others] = copies;
      out.push({
        kind: "duplicate-id",
        id,
        file: rel(copies[0]),
        message: `${copies.length} different tasks share id ${id} (${where}).`,
        fix: `Give ${others.length} of them a new id.`,
        apply: () => {
          for (const c of others) updateTask({ ...c, id: nanoid(8) }, c.id);
        },
      });
    }
  }
  const duplicatesPending = out.length > 0;

  for (const t of tasks) {
    // --- completed without a ✅ date (ticked in Obsidian without the Tasks plugin's done-date setting) ---
    if (t.done && !t.doneDate) {
      const estimate = t.created ?? todayStr();
      out.push({
        kind: "missing-done-date",
        id: t.id,
        file: rel(t),
        message: `"${t.title}" is done but has no ✅ date.`,
        fix: `Set ✅ ${estimate} (${t.created ? "its created date" : "today"}, a best estimate).`,
        apply: () => updateTask({ ...t, doneDate: estimate }),
      });
    }

    // --- CLI output or flags stuck in the title ---
    const cleaned = cleanTitle(t.title);
    if (cleaned !== t.title && cleaned.length) {
      out.push({
        kind: "title-junk",
        id: t.id,
        file: rel(t),
        message: `Title "${t.title}" contains CLI output or a stray flag.`,
        fix: `Rename to "${cleaned}".`,
        apply: () => updateTask({ ...t, title: cleaned }),
      });
    }

    // --- in Inbox.md but tagged into a project/area, which hides it from the Inbox view ---
    if (basename(t.location.file) === "Inbox.md" && (t.project || t.area)) {
      // The name came from a slug tag (#area/work → "Work"), so match it to a real file.
      const findFile = (name: string | null, files: string[]) =>
        name ? files.find((f) => f.toLowerCase() === name.toLowerCase()) : undefined;
      const project = findFile(t.project, listProjectFiles(config));
      const area = findFile(t.area, listAreaFiles(config));
      const dest = project ? `Projects/${project}.md` : area ? `Areas/${area}.md` : undefined;
      out.push({
        kind: "misfiled-inbox",
        id: t.id,
        file: rel(t),
        message: `"${t.title}" sits in Inbox.md but is tagged ${t.project ? `project ${t.project}` : `area ${t.area}`}, so no view shows it as Inbox.`,
        fix: dest ? `Move to ${dest}.` : undefined,
        apply: dest ? () => moveTask(config, t, project ? { project } : { area: area! }) : undefined,
      });
    }
  }
  // Every other fix locates lines by id, so only duplicates are fixable until they're
  // settled; fixVault rescans after each fix, so the rest become fixable next pass.
  if (duplicatesPending) {
    for (const d of out) if (d.kind !== "duplicate-id") delete d.apply;
  }
  return out;
}

function strip({ apply, ...issue }: Diagnosis): Issue {
  return issue;
}

/** Read-only health check of the vault's task files. */
export function checkVault(config: AppConfig): Issue[] {
  return diagnose(config).map(strip);
}

/**
 * Applies every automatic fix. Rescans after each one, since fixes change line
 * numbers. Returns what was fixed plus anything left that needs a human.
 */
export function fixVault(config: AppConfig): { fixed: Issue[]; remaining: Issue[] } {
  const fixed: Issue[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    const next = diagnose(config).find((d) => d.apply);
    if (!next) break;
    next.apply!();
    fixed.push(strip(next));
  }
  return { fixed, remaining: checkVault(config) };
}
