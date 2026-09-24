import { basename, dirname, join, relative } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { type AppConfig, loadConfig } from "../../../src/config.js";
import { dailyNotePath, readSection } from "../../../src/core/dailyNote.js";
import { taskJson } from "../../../src/core/json.js";
import { quickParse } from "../../../src/core/quickParse.js";
import { TaskStore } from "../../../src/core/store.js";
import { type Task, todayStr } from "../../../src/core/task.js";
import type { CapturePreview, Result, Snapshot, WidgetTask } from "../shared/api.js";

const RESCAN_DEBOUNCE_MS = 300;
const DAILY_NOTE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

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
      today: [],
      followUps: [],
      doneToday: [],
      inboxCount: 0,
      plan: null,
      pillVisible,
      error: this.loadError,
    };
    const store = this.store;
    const config = this.config;
    if (!store || !config || this.loadError) return empty;

    const today = todayStr();
    const view = (t: Task): WidgetTask => {
      const j = taskJson(t, store);
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
        focus: j.focus,
        overdue: !!((j.due && j.due < today) || (j.scheduled && j.scheduled < today)),
        done: j.done,
      };
    };

    const focus = store.focus().map(view);
    const followUps = store
      .waiting()
      .filter((t) => t.scheduled && t.scheduled <= today)
      .map(view);
    const shown = new Set([...focus, ...followUps].map((t) => t.id));
    const todayList = store
      .today()
      .filter((t) => !shown.has(t.id))
      .map(view)
      .sort((a, b) => Number(b.overdue) - Number(a.overdue));

    return {
      ...empty,
      date: today,
      focus,
      today: todayList,
      followUps,
      doneToday: store
        .all()
        .filter((t) => t.done && t.doneDate === today)
        .map(view),
      inboxCount: store.inbox().length,
      plan: readSection(config, today, "Plan"),
    };
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

  previewCapture(text: string): CapturePreview {
    const { title, scheduled } = quickParse(text);
    return { title, scheduled: scheduled ?? null };
  }

  /** Quick capture always lands in the Inbox; Claude or the user files it later. */
  capture(text: string): Result {
    if (!this.store) return { ok: false, error: this.loadError ?? "Vault not loaded." };
    if (!text.trim()) return { ok: false, error: "Nothing to add." };
    try {
      this.store.refresh({ persistIds: true });
      this.store.add(quickParse(text));
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
