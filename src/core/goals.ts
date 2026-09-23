import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { AppConfig } from "../config.js";
import { slugify } from "./task.js";
import { writeFileAtomic } from "./vault.js";

/**
 * Goals live in <tasks>/Goals.md, one per `## Heading`; the text under a heading is
 * what "done" looks like. Optional frontmatter `horizon: YYYY-MM-DD` is the date the
 * set is meant to be achieved by. No checkboxes here, so the task scanner ignores it.
 */
export interface Goal {
  name: string;
  slug: string;
  description: string;
}

export interface GoalsFile {
  horizon: string | null;
  goals: Goal[];
}

export function goalsPath(config: AppConfig): string {
  return join(config.vaultPath, config.tasksDir, "Goals.md");
}

export function loadGoals(config: AppConfig): GoalsFile {
  const path = goalsPath(config);
  if (!existsSync(path)) return { horizon: null, goals: [] };
  const { data, content } = matter(readFileSync(path, "utf8"));

  const goals: Goal[] = [];
  let current: { name: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) {
      goals.push({ name: current.name, slug: slugify(current.name), description: current.lines.join("\n").trim() });
    }
  };
  for (const line of content.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = { name: heading[1], lines: [] };
    } else if (/^#\s/.test(line)) {
      flush();
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();

  const horizon = data.horizon instanceof Date ? data.horizon.toISOString().slice(0, 10) : data.horizon ?? null;
  return { horizon: horizon ? String(horizon) : null, goals };
}

/** Matches a goal by name or slug, case-insensitively. Throws with the valid names so typos don't create orphan links. */
export function resolveGoal(goals: Goal[], nameOrSlug: string): Goal {
  const wanted = slugify(nameOrSlug);
  const goal = goals.find((g) => g.slug === wanted);
  if (!goal) {
    const known = goals.map((g) => `"${g.name}"`).join(", ") || "(none — Goals.md is empty or missing)";
    throw new Error(`Unknown goal "${nameOrSlug}". Goals: ${known}.`);
  }
  return goal;
}

function projectPath(config: AppConfig, project: string): string {
  return join(config.vaultPath, config.tasksDir, "Projects", `${project}.md`);
}

export function readProjectMeta(config: AppConfig, project: string): { goal: string | null; area: string | null } {
  const path = projectPath(config, project);
  if (!existsSync(path)) return { goal: null, area: null };
  const { data } = matter(readFileSync(path, "utf8"));
  return { goal: data.goal ? String(data.goal) : null, area: data.area ? String(data.area) : null };
}

/** Sets (or with null, removes) frontmatter keys on an existing project file, leaving its body untouched. */
export function updateProjectMeta(
  config: AppConfig,
  project: string,
  patch: { goal?: string | null; area?: string | null },
): void {
  const path = projectPath(config, project);
  if (!existsSync(path)) throw new Error(`No project named "${project}" (looked for ${path}).`);
  const raw = readFileSync(path, "utf8");
  const parsed = matter(raw);
  const data: Record<string, unknown> = { ...parsed.data };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete data[key];
    else data[key] = value;
  }
  const body = parsed.content.replace(/^\n+/, "");
  const out = Object.keys(data).length ? matter.stringify(`\n${body}`, data) : body;
  writeFileAtomic(path, out);
}
