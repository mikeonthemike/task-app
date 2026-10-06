import { basename, dirname, join, relative } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { type AppConfig, loadConfig } from "../../../src/config.js";
import { dailyNotePath, proposedTop3, readSection } from "../../../src/core/dailyNote.js";
import { eisenhower } from "../../../src/core/eisenhower.js";
import { taskJson } from "../../../src/core/json.js";
import { quickParse } from "../../../src/core/quickParse.js";
import { TaskStore } from "../../../src/core/store.js";
import { type Task, todayStr } from "../../../src/core/task.js";
import type { CapturePreview, ListId, Matrix, MoveDest, ListInfo, Result, Snapshot, TaskPatch, WidgetTask } from "../shared/api.js";

const RESCAN_DEBOUNCE_MS = 300;
const DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const LOGBOOK_LIMIT = 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = new Set(["highest", "high", "medium", "low", "lowest"]);

/** Only the fields the widget may change, each checked, so a bad value never reaches the vault. */
function cleanPatch(patch: TaskPatch): TaskPatch {
  const out: TaskPatch = {};
  for (const key of ["scheduled", "due"] as const) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v !== null && !DATE_RE.test(v)) throw new Error(`"${v}" isn't a date.`);
    out[key] = v;
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== null && !PRIORITIES.has(patch.priority)) throw new Error(`"${patch.priority}" isn't a priority.`);
    out.priority = patch.priority;
  }
  return out;
}

/** Every open task outside Someday: Inbox first, then projects, then areas, each A–Z. */
function allOpen(store: TaskStore): Task[] {
  const rank = (t: Task) => (t.project ? 1 : t.area ? 2 : 0);
  return store
    .all()
    .filter((t) => !t.done && !t.someday)
    .sort((a, b) => rank(a) - rank(b) || (a.project ?? a.area ?? "").localeCompare(b.project ?? b.area ?? ""));
}

/**
 * Owns the one TaskStore the widget reads from. Rescans are read-only (persistIds: false) so
 * an Obsidian autosave mid-typing never gets a 🆔 appended under the cursor; ids are only
 * written when the user acts on a task here, just as running the CLI would.
 */
export class VaultService {
  private config: AppConfig | null = null;
  private store: TaskStore | null = null;
  private loadError: string | null = null;
  private watchers: FSWatcher[] = [];
  private debounce: NodeJS.Timeout | null = null;
  private dayTimer: NodeJS.Timeout | null = null;
  private day = todayStr();

  constructor(private onChange: () => void) {}

  start(): void {
    try {
      this.config = loadConfig();
      this.store = new TaskStore(this.config, { persistIds: false });
      this.loadError = null;
    } catch (e) {
      this.loadError = (e as Error).message;
      return;
    }
    const opts = { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } };
    const tasksRoot = join(this.config.vaultPath, this.config.tasksDir);
    // Daily notes default to the vault root, so that watcher stays shallow and only cares
    // about YYYY-MM-DD.md files; the Tasks folder is watched in full.
    this.watchers = [
      watch(tasksRoot, { ...opts, ignored: (path) => basename(path).startsWith(".") }),
      watch(dirname(dailyNotePath(this.config, this.day)), {
        ...opts,
        depth: 0,
        ignored: (path, stats) => !!stats?.isFile() && !DAILY_NOTE_RE.test(basename(path)),
      }),
    ];
    for (const w of this.watchers) w.on("all", () => this.scheduleRescan());
    // Roll "today" over at midnight (and after the laptop wakes on a new day).
    this.dayTimer = setInterval(() => {
      if (todayStr() !== this.day) {
        this.day = todayStr();
        this.rescan();
      }
    }, 60_000);
  }

  async stop(): Promise<void> {
    if (this.dayTimer) clearInterval(this.dayTimer);
    if (this.debounce) clearTimeout(this.debounce);
    await Promise.all(this.watchers.map((w) => w.close()));
  }

  rescan(): void {
    if (!this.store) return;
    try {
      this.store.refresh();
      this.loadError = null;
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    this.onChange();
  }

  private scheduleRescan(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.rescan(), RESCAN_DEBOUNCE_MS);
  }

  snapshot(pillVisible: boolean): Snapshot {
    const empty: Snapshot = {
      date: todayStr(),
      focus: [],
      proposed: [],
      today: [],
      followUps: [],
      doneToday: [],
      inboxCount: 0,
      plan: null,
      lists: [],
      pillVisible,
      error: this.loadError,
    };
    const store = this.store;
    const config = this.config;
    if (!store || !config || this.loadError) return empty;

    const today = todayStr();
    const view = (t: Task) => this.toWidget(t, today);

    const plan = readSection(config, today, "Plan");
    const focus = store.focus().map(view);
    const proposed = focus.length || !plan ? [] : this.resolveProposed(plan).map(view);
    const followUps = store
      .waiting()
      .filter((t) => t.scheduled && t.scheduled <= today)
      .map(view);
    const shown = new Set([...focus, ...proposed, ...followUps].map((t) => t.id));
    const todayList = store
      .today()
      .filter((t) => !shown.has(t.id))
      .map(view)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue));

    return {
      ...empty,
      date: today,
      focus,
      proposed,
      today: todayList,
      followUps,
      doneToday: store
        .all()
        .filter((t) => t.done && t.doneDate === today)
        .map(view),
      inboxCount: store.inbox().length,
      plan,
      lists: this.lists(store),
    };
  }

  /** Tasks for one popover list, in the same order the TUI shows them. */
  list(id: ListId): WidgetTask[] {
    const store = this.store;
    if (!store || this.loadError) return [];
    const today = todayStr();
    return this.tasksFor(store, id).map((t) => this.toWidget(t, today));
  }

  /** The Eisenhower popout: the same quadrants as the vault's Eisenhower.md note. */
  matrix(): Matrix {
    const store = this.store;
    const config = this.config;
    const empty: Matrix = { doNow: [], schedule: [], delegate: [], question: [], waiting: [] };
    if (!store || !config || this.loadError) return empty;
    const today = todayStr();
    const m = eisenhower(store.all(), today, config.vaultPath);
    const view = (ts: Task[]) => ts.map((t) => this.toWidget(t, today));
    return {
      doNow: view(m.doNow),
      schedule: view(m.schedule),
      delegate: view(m.delegate),
      question: view(m.question),
      waiting: view(m.waiting),
    };
  }

  private tasksFor(store: TaskStore, id: ListId): Task[] {
    if (id.startsWith("project:")) return store.byProject(id.slice("project:".length));
    if (id.startsWith("area:")) return store.byArea(id.slice("area:".length));
    switch (id) {
      case "today":
        return store.today();
      case "all":
        return allOpen(store);
      case "inbox":
        return store.inbox();
      case "waiting":
        return store.waiting();
      case "upcoming":
        return store.upcoming();
      case "anytime":
        return store.anytime();
      case "someday":
        return store.someday();
      case "logbook":
        return store.logbook().slice(0, LOGBOOK_LIMIT);
      default:
        return [];
    }
  }

  private lists(store: TaskStore): ListInfo[] {
    const view = (id: ListId, label: string): ListInfo => ({
      id,
      label,
      kind: "view",
      count: id === "logbook" ? null : this.tasksFor(store, id).length,
    });
    return [
      view("today", "Today"),
      view("all", "All open"),
      view("inbox", "Inbox"),
      view("waiting", "Waiting"),
      view("upcoming", "Upcoming"),
      view("anytime", "Anytime"),
      view("someday", "Someday"),
      view("logbook", "Logbook"),
      ...store.projects().map((name): ListInfo => ({ id: `project:${name}`, label: name, kind: "project", count: store.byProject(name).length })),
      ...store.areas().map((name): ListInfo => ({ id: `area:${name}`, label: name, kind: "area", count: store.byArea(name).length })),
    ];
  }

  private toWidget(t: Task, today: string): WidgetTask {
    const j = taskJson(t, this.store!);
    return {
      id: j.id,
      title: j.title,
      project: j.project,
      area: j.area,
      due: j.due,
      scheduled: j.scheduled,
      priority: j.priority,
      estimateMinutes: j.estimateMinutes,
      waitingOn: j.waitingOn,
      recurrence: j.recurrence,
      focus: j.focus,
      inbox: !t.project && !t.area && !t.someday && basename(t.location.file) === "Inbox.md",
      overdue: !!((j.due && j.due < today) || (j.scheduled && j.scheduled < today)),
      done: j.done,
    };
  }

  /** Each proposed item's first id that is still an open task (done or deleted ones drop out). */
  private resolveProposed(plan: string): Task[] {
    return proposedTop3(plan).flatMap((ids) => {
      const t = ids.map((id) => this.store!.byId(id)).find((x) => x && !x.done);
      return t ? [t] : [];
    });
  }

  complete(id: string): Result {
    return this.mutate(id, (store, realId) => {
      const r = store.completeWithRecurrence(realId);
      if (!r) throw new Error("That task is gone. It may have been edited elsewhere.");
    });
  }

  uncomplete(id: string): Result {
    return this.mutate(id, (store, realId) => {
      if (!store.uncomplete(realId)) throw new Error("That task is gone. It may have been edited elsewhere.");
    });
  }

  move(id: string, dest: MoveDest): Result {
    return this.mutate(id, (store, realId) => {
      if (!store.move(realId, dest)) throw new Error("That task is gone. It may have been edited elsewhere.");
    });
  }

  /** Dates and priority, changed in place; the task stays in its file. */
  edit(id: string, patch: TaskPatch): Result {
    return this.mutate(id, (store, realId) => {
      const fields = cleanPatch(patch);
      const t = store.byId(realId);
      if (!t) throw new Error("That task is gone. It may have been edited elsewhere.");
      const due = fields.due === undefined ? t.due : fields.due;
      const scheduled = fields.scheduled === undefined ? t.scheduled : fields.scheduled;
      if (t.recurrence && !due && !scheduled) throw new Error("A repeating task needs a date to count from.");
      store.edit(realId, fields);
    });
  }

  previewCapture(text: string): CapturePreview {
    const { title, scheduled, due, recurrence, warning } = quickParse(text, new Date(), { dateOrder: this.config?.dateOrder });
    return { title, scheduled: scheduled ?? null, due: due ?? null, recurrence: recurrence ?? null, warning: warning ?? null };
  }

  /** Quick capture always lands in the Inbox; Claude or the user files it later. */
  capture(text: string): Result {
    if (!this.store) return { ok: false, error: this.loadError ?? "Vault not loaded." };
    if (!text.trim()) return { ok: false, error: "Nothing to add." };
    try {
      this.store.refresh({ persistIds: true });
      const { warning: _warning, ...input } = quickParse(text, new Date(), { dateOrder: this.config?.dateOrder });
      this.store.add(input);
      this.rescan();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** obsidian://open for the file the task lives in (Obsidian has no deep link to a line). */
  obsidianUrlForTask(id: string): string | null {
    const t = this.store?.byId(id);
    return t && this.config ? this.obsidianUrl(t.location.file) : null;
  }

  obsidianUrlForDailyNote(): string | null {
    return this.config ? this.obsidianUrl(dailyNotePath(this.config, todayStr())) : null;
  }

  private obsidianUrl(file: string): string {
    const { vaultPath } = this.config!;
    const vault = encodeURIComponent(basename(vaultPath));
    const path = encodeURIComponent(relative(vaultPath, file).replace(/\.md$/, ""));
    return `obsidian://open?vault=${vault}&file=${path}`;
  }

  /**
   * Every write starts from a fresh id-persisting scan, so line numbers are current. A task
   * that was id-less in the last read-only scan is matched by file and title instead.
   */
  private mutate(id: string, fn: (store: TaskStore, realId: string) => void): Result {
    const store = this.store;
    if (!store) return { ok: false, error: this.loadError ?? "Vault not loaded." };
    try {
      const before = store.byId(id);
      store.refresh({ persistIds: true });
      let realId = id;
      if (before?.idPending) {
        const match = store
          .all()
          .find((t) => t.location.file === before.location.file && t.title === before.title && t.done === before.done);
        if (!match) throw new Error(`Couldn't find "${before.title}" any more. It may have been edited elsewhere.`);
        realId = match.id;
      }
      fn(store, realId);
      this.rescan();
      return { ok: true };
    } catch (e) {
      this.rescan();
      return { ok: false, error: (e as Error).message };
    }
  }
}
