import type { AppConfig } from "../config.js";
import { checkVault } from "./doctor.js";
import { taskJson } from "./json.js";
import { estimateMinutes } from "./meta.js";
import type { TaskStore } from "./store.js";
import type { Task } from "./task.js";
import { addDays, daysBetween, todayStr } from "./task.js";

export const INBOX_STALE_DAYS = 3;
export const TASK_STALE_DAYS = 21;
export const DUE_SOON_DAYS = 7;
const RECENT_DAYS = 7;

/**
 * Everything the morning plan, shutdown and weekly review need to reason about, in one
 * read. Pure data — deciding what it means is the planner's (Claude's) job.
 */
export function buildReview(config: AppConfig, store: TaskStore, today = todayStr()) {
  const json = (t: Task) => taskJson(t, store);
  const all = store.all();
  const open = all.filter((t) => !t.done);
  const recentlyDone = all.filter((t) => t.done && t.doneDate && daysBetween(t.doneDate, today) < RECENT_DAYS);
  const age = (t: Task) => (t.created ? daysBetween(t.created, today) : null);
  const minutes = (ts: Task[]) => ts.reduce((sum, t) => sum + (estimateMinutes(t) ?? 0), 0);

  const focus = store.focus();
  const todayTasks = store.today();
  const waiting = store.waiting();

  const projectNames = store.projects();
  const projects = projectNames.map((name) => {
    const openHere = open.filter((t) => t.project === name);
    return {
      name,
      goal: store.projectGoal(name),
      open: openHere.length,
      doneLast7: recentlyDone.filter((t) => t.project === name).length,
      /** No open tasks, so nothing moves it forward. */
      noNextAction: openHere.filter((t) => !t.someday).length === 0,
    };
  });

  const goals = store.goals().map((g) => {
    const openHere = open.filter((t) => store.goalOf(t) === g.name && !t.someday);
    return {
      name: g.name,
      description: g.description,
      projects: projects.filter((p) => p.goal?.toLowerCase() === g.name.toLowerCase()).map((p) => p.name),
      open: openHere.length,
      focusToday: focus.filter((t) => store.goalOf(t) === g.name).length,
      doneLast7: recentlyDone.filter((t) => store.goalOf(t) === g.name).length,
      /** Nothing open serves this goal at all. */
      noActiveTask: openHere.length === 0,
    };
  });

  return {
    date: today,
    horizon: store.horizon(),
    daysToHorizon: store.horizon() ? daysBetween(today, store.horizon()!) : null,
    counts: {
      open: open.length,
      inbox: store.inbox().length,
      today: todayTasks.length,
      overdue: store.overdue().length,
      focus: focus.length,
      waiting: waiting.length,
      doneLast7: recentlyDone.length,
      doneToday: all.filter((t) => t.done && t.doneDate === today).length,
    },
    focus: focus.map(json),
    today: todayTasks.map(json),
    overdue: store.overdue().map(json),
    dueSoon: open
      .filter((t) => t.due && t.due > today && t.due <= addDays(today, DUE_SOON_DAYS))
      .sort((a, b) => a.due!.localeCompare(b.due!))
      .map(json),
    inbox: store.inbox().map((t) => ({ ...json(t), ageDays: age(t), stale: (age(t) ?? 0) >= INBOX_STALE_DAYS })),
    waiting: {
      followUpDue: waiting.filter((t) => t.scheduled && t.scheduled <= today).map(json),
      noFollowUpDate: waiting.filter((t) => !t.scheduled).map(json),
      later: waiting.filter((t) => t.scheduled && t.scheduled > today).map(json),
    },
    goals,
    projects,
    /** Open, dated-or-filed work that isn't linked to any goal (excludes Inbox and Someday). */
    unlinked: open.filter((t) => !t.someday && !store.goalOf(t) && (t.project || t.area)).map(json),
    /** Open for a while with no dates and no focus — candidates to schedule, drop or move to Someday. */
    stale: open
      .filter((t) => !t.someday && !t.scheduled && !t.due && (age(t) ?? 0) >= TASK_STALE_DAYS)
      .map((t) => ({ ...json(t), ageDays: age(t) })),
    estimates: {
      focusMinutes: minutes(focus),
      todayMinutes: minutes(todayTasks),
      unestimatedToday: todayTasks.filter((t) => estimateMinutes(t) === null).map((t) => t.id),
    },
    doneToday: all.filter((t) => t.done && t.doneDate === today).map(json),
    recentlyDone: recentlyDone.map(json),
    vaultIssues: checkVault(config),
  };
}
