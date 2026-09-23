import type { AppConfig } from "../config.js";
import { appendTask, completeTask, listAreaFiles, listProjectFiles, moveTask, scanVault, sweepCompletedTasks, updateTask } from "./vault.js";
import type { NewTaskInput, Task } from "./task.js";
import { isPastOrToday, isToday, todayStr } from "./task.js";
import { type Goal, type GoalsFile, loadGoals, readProjectMeta } from "./goals.js";
import { focusTags, goalSlugTag, isFocus, MAX_FOCUS, waitingOn } from "./meta.js";

export class TaskStore {
  private tasks: Task[] = [];
  private goalsFile: GoalsFile = { horizon: null, goals: [] };
  private projectGoals = new Map<string, string | null>();

  constructor(private config: AppConfig) {
    this.refresh();
  }

  refresh(): void {
    this.tasks = scanVault(this.config);
    this.goalsFile = loadGoals(this.config);
    this.projectGoals.clear();
  }

  goals(): Goal[] {
    return this.goalsFile.goals;
  }

  horizon(): string | null {
    return this.goalsFile.horizon;
  }

  /** A task's own #goal/… tag wins; otherwise it inherits its project's `goal:` frontmatter. */
  goalOf(t: Task): string | null {
    const slug = goalSlugTag(t);
    if (slug) return this.goals().find((g) => g.slug === slug)?.name ?? slug;
    if (!t.project) return null;
    if (!this.projectGoals.has(t.project)) {
      this.projectGoals.set(t.project, readProjectMeta(this.config, t.project).goal);
    }
    const name = this.projectGoals.get(t.project) ?? null;
    return name ? (this.goals().find((g) => g.name.toLowerCase() === name.toLowerCase())?.name ?? name) : null;
  }

  projectGoal(project: string): string | null {
    return readProjectMeta(this.config, project).goal;
  }

  /** Today's top tasks (#focus), open only. */
  focus(): Task[] {
    return this.tasks.filter((t) => !t.done && isFocus(t));
  }

  /** Open tasks waiting on someone, follow-ups soonest first (none-set last). */
  waiting(): Task[] {
    return this.tasks
      .filter((t) => !t.done && waitingOn(t) !== null)
      .sort((a, b) => (a.scheduled ?? "9999").localeCompare(b.scheduled ?? "9999"));
  }

  /**
   * Makes exactly `ids` today's focus: tags them #focus and untags every other open task.
   * Capped at MAX_FOCUS unless `force`, since a top 3 of eight isn't a top 3.
   */
  setFocus(ids: string[], force = false): Task[] {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_FOCUS && !force) {
      throw new Error(`That's ${unique.length} focus tasks; the cap is ${MAX_FOCUS}. Pick fewer, or pass --force.`);
    }
    for (const id of unique) {
      const t = this.byId(id);
      if (!t) throw new Error(`No task with id "${id}".`);
      if (t.done) throw new Error(`Task ${id} ("${t.title}") is already done.`);
    }
    for (const t of this.focus()) {
      if (!unique.includes(t.id)) this.edit(t.id, { tags: focusTags(t.tags, false) });
    }
    for (const id of unique) {
      const t = this.byId(id)!;
      if (!isFocus(t)) this.edit(id, { tags: focusTags(t.tags, true) });
    }
    return this.focus();
  }

  all(): Task[] {
    return this.tasks;
  }

  byId(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Things "Today": today's focus, plus anything scheduled or due today/overdue — and not done. */
  today(): Task[] {
    return this.tasks.filter(
      (t) => !t.done && (isFocus(t) || isPastOrToday(t.scheduled) || isPastOrToday(t.due)),
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
    const updated = updateTask({ ...task, done: false, doneDate: null });
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  reschedule(id: string, scheduled: string | null): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated = updateTask({ ...task, scheduled });
    this.tasks = this.tasks.map((t) => (t.id === id ? updated : t));
    return updated;
  }

  /** Updates in-place fields (title, dates, priority, recurrence, tags) without changing which file the task lives in. */
  edit(id: string, patch: Partial<Pick<Task, "title" | "due" | "scheduled" | "start" | "priority" | "recurrence" | "tags">>): Task | undefined {
    const task = this.byId(id);
    if (!task) return undefined;
    const updated = updateTask({ ...task, ...patch });
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
