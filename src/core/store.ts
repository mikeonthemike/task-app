import type { AppConfig } from "../config.js";
import { appendTask, completeTask, listAreaFiles, listProjectFiles, moveTask, scanVault, sweepCompletedTasks, updateTask } from "./vault.js";
import type { NewTaskInput, Task } from "./task.js";
import { isPastOrToday, isToday, todayStr } from "./task.js";

export class TaskStore {
  private tasks: Task[] = [];

  constructor(private config: AppConfig) {
    this.refresh();
  }

  refresh(): void {
    this.tasks = scanVault(this.config);
  }

  all(): Task[] {
    return this.tasks;
  }

  byId(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Things "Today": scheduled for today/overdue, or due today/overdue — and not done. */
  today(): Task[] {
    return this.tasks.filter(
      (t) => !t.done && (isPastOrToday(t.scheduled) || isPastOrToday(t.due)),
    );
  }

  overdue(): Task[] {
    const today = todayStr();
    return this.tasks.filter(
      (t) => !t.done && ((t.scheduled && t.scheduled < today) || (t.due && t.due < today)),
    );
  }

  upcoming(): Task[] {
    const today = todayStr();
    return this.tasks
      .filter((t) => !t.done && ((t.scheduled && t.scheduled > today) || (t.due && t.due > today)))
      .sort((a, b) => (a.scheduled ?? a.due ?? "").localeCompare(b.scheduled ?? b.due ?? ""));
  }

  inbox(): Task[] {
    return this.tasks.filter(
      (t) => !t.done && !t.project && !t.area && !t.someday && this.fileNameOf(t) === "Inbox.md",
    );
  }

  anytime(): Task[] {
    return this.tasks.filter(
      (t) => !t.done && !t.someday && !t.scheduled && !t.due && (t.project || t.area),
    );
  }

  someday(): Task[] {
    return this.tasks.filter((t) => !t.done && t.someday);
  }

  logbook(): Task[] {
    return this.tasks
      .filter((t) => t.done)
      .sort((a, b) => (b.doneDate ?? "").localeCompare(a.doneDate ?? ""));
  }

  byProject(project: string): Task[] {
    return this.tasks.filter((t) => t.project === project && !t.done);
  }

  byArea(area: string): Task[] {
    return this.tasks.filter((t) => t.area === area && !t.done);
  }

  projects(): string[] {
    return listProjectFiles(this.config);
  }

  areas(): string[] {
    return listAreaFiles(this.config);
  }

  add(input: NewTaskInput): Task {
    const task = appendTask(this.config, input);
    this.tasks.push(task);
    return task;
  }

  complete(id: string): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated = completeTask(task);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  uncomplete(id: string): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated: Task = { ...task, done: false, doneDate: null };
    updateTask(updated);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  reschedule(id: string, scheduled: string | null): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated: Task = { ...task, scheduled };
    updateTask(updated);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  /** Updates in-place fields (title, dates, priority, recurrence, tags) without changing which file the task lives in. */
  edit(id: string, patch: Partial<Pick<Task, "title" | "due" | "scheduled" | "start" | "priority" | "recurrence" | "tags">>): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated: Task = { ...task, ...patch };
    updateTask(updated);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  /** Moves a task to a different project/area/someday destination (this changes which file it lives in). */
  move(id: string, dest: { project?: string | null; area?: string | null; someday?: boolean }): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated = moveTask(this.config, task, dest);
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  /** Physically relocates completed tasks into Logbook.md, tidying up Project/Area files. Returns what moved. */
  sweep(): Task[] {
    const moved = sweepCompletedTasks(this.config);
    this.refresh();
    return moved;
  }

  private fileNameOf(task: Task): string {
    const parts = task.location.file.split("/");
    return parts[parts.length - 1];
  }
}
