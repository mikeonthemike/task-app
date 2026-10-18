import type { AppConfig } from "../config.js";
import { buildReview } from "../core/review.js";
import { dailyNotePath, listSections, readNote, readSection } from "../core/dailyNote.js";
import { resolveGoal } from "../core/goals.js";
import { taskJson } from "../core/json.js";
import { estimateTags, goalTags, waitingTags } from "../core/meta.js";
import { tasksForSection } from "../core/sections.js";
import { TaskStore } from "../core/store.js";
import { normalizeTag, nullableDate, parsePriority } from "../core/cliArgs.js";
import { requireCleanTitle } from "../core/title.js";
import { todayStr, type NewTaskInput } from "../core/task.js";

/** Cap on rows returned by `list_tasks`, so `all` or `logbook` can't flood the chat context. */
export const DEFAULT_LIST_LIMIT = 100;

export function listTasks(config: AppConfig, section: string, limit = DEFAULT_LIST_LIMIT) {
  const store = new TaskStore(config);
  const tasks = tasksForSection(store, section);
  return {
    section,
    total: tasks.length,
    truncated: tasks.length > limit,
    tasks: tasks.slice(0, limit).map((t) => taskJson(t, store)),
  };
}

export function reviewTasks(config: AppConfig, date?: string) {
  const store = new TaskStore(config);
  return buildReview(config, store, nullableDate(date, "date") ?? todayStr());
}

export function goalsSummary(config: AppConfig) {
  const { goals, horizon, daysToHorizon } = buildReview(config, new TaskStore(config));
  return { horizon, daysToHorizon, goals };
}

export function dailyNote(config: AppConfig, date?: string, section?: string) {
  const day = nullableDate(date, "date") ?? todayStr();
  if (section) return { date: day, section, text: readSection(config, day, section) };
  return {
    date: day,
    path: dailyNotePath(config, day),
    exists: readNote(config, day) !== null,
    sections: Object.fromEntries(listSections(config, day).map((name) => [name, readSection(config, day, name)])),
  };
}

export interface AddTaskArgs {
  title: string;
  project?: string;
  area?: string;
  due?: string;
  scheduled?: string;
  priority?: string;
  tags?: string[];
  notes?: string[];
  waiting?: string;
  est?: string;
  goal?: string;
  someday?: boolean;
}

/**
 * Adds a task. With no project/area/someday it lands in the Inbox. The title is always kept
 * verbatim: the caller (Claude) resolves dates and passes them as fields, as `task-app add` expects.
 */
export function addTask(config: AppConfig, a: AddTaskArgs) {
  const store = new TaskStore(config);
  if (a.project && !store.projects().includes(a.project)) {
    throw new Error(`No project named "${a.project}". Projects: ${store.projects().map((p) => `"${p}"`).join(", ") || "(none)"}.`);
  }
  if (a.area && !store.areas().includes(a.area)) {
    throw new Error(`No area named "${a.area}". Areas: ${store.areas().map((p) => `"${p}"`).join(", ") || "(none)"}.`);
  }
  let tags = (a.tags ?? []).map(normalizeTag);
  if (a.goal) tags = goalTags(tags, resolveGoal(store.goals(), a.goal).name);
  if (a.waiting) tags = waitingTags(tags, a.waiting);
  if (a.est) tags = estimateTags(tags, a.est);

  const input: NewTaskInput = {
    title: requireCleanTitle(a.title),
    project: a.project ?? null,
    area: a.area ?? null,
    due: nullableDate(a.due, "due") ?? null,
    scheduled: nullableDate(a.scheduled, "scheduled") ?? null,
    priority: parsePriority(a.priority) ?? null,
    tags,
    notes: a.notes ?? [],
    someday: a.someday ?? false,
  };
  return taskJson(store.add(input), store);
}
