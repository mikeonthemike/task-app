import type { TaskStore } from "./store.js";
import type { Task } from "./task.js";
import { resolveGoal } from "./goals.js";

/** Resolves a `list` section name (`today`, `project:<name>`, …) to its tasks; throws on an unknown one. */
export function tasksForSection(store: TaskStore, section: string): Task[] {
  if (section === "inbox") return store.inbox();
  if (section === "today") return store.today();
  if (section === "overdue") return store.overdue();
  if (section === "upcoming") return store.upcoming();
  if (section === "anytime") return store.anytime();
  if (section === "someday") return store.someday();
  if (section === "logbook") return store.logbook();
  if (section === "all") return store.all();
  if (section === "focus") return store.focus();
  if (section === "waiting") return store.waiting();
  if (section === "recurring") return store.recurring();
  if (section.startsWith("goal:")) {
    const goal = resolveGoal(store.goals(), section.slice("goal:".length));
    return store.all().filter((t) => !t.done && store.goalOf(t) === goal.name);
  }
  if (section.startsWith("project:")) return store.byProject(section.slice("project:".length));
  if (section.startsWith("area:")) return store.byArea(section.slice("area:".length));
  throw new Error(`Unknown section "${section}". See "task-app help".`);
}
