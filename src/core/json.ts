import type { TaskStore } from "./store.js";
import type { Task } from "./task.js";
import { estimateMinutes, isFocus, waitingOn } from "./meta.js";

/** The one JSON shape for a task, used by `list --json`, `review --json`, etc. */
export function taskJson(t: Task, store: TaskStore) {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    doneDate: t.doneDate,
    priority: t.priority,
    scheduled: t.scheduled,
    due: t.due,
    start: t.start,
    created: t.created,
    recurrence: t.recurrence,
    tags: t.tags,
    project: t.project,
    area: t.area,
    goal: store.goalOf(t),
    focus: isFocus(t),
    waitingOn: waitingOn(t),
    estimateMinutes: estimateMinutes(t),
    someday: t.someday,
    notes: t.notes,
  };
}

export type TaskJson = ReturnType<typeof taskJson>;
