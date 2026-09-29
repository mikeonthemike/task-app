/** What the main process sends every window. Plain JSON, rebuilt on every vault change. */
export interface WidgetTask {
  id: string;
  title: string;
  project: string | null;
  area: string | null;
  due: string | null;
  scheduled: string | null;
  priority: string | null;
  estimateMinutes: number | null;
  waitingOn: string | null;
  focus: boolean;
  overdue: boolean;
  done: boolean;
}

/** The TUI's lists, plus "all" (every open task outside Someday, grouped by project/area). */
export type ListId =
  | "today"
  | "all"
  | "inbox"
  | "waiting"
  | "upcoming"
  | "anytime"
  | "someday"
  | "logbook"
  | `project:${string}`
  | `area:${string}`;

export interface ListInfo {
  id: ListId;
  label: string;
  kind: "view" | "project" | "area";
  /** Open tasks in it; null where a count isn't meaningful (Logbook). */
  count: number | null;
}

export interface Snapshot {
  date: string;
  /** Open #focus tasks: the top 3 Claude proposed and the user confirmed. Read-only here. */
  focus: WidgetTask[];
  /**
   * When nothing is tagged #focus yet: the top 3 today's `## Plan` proposes, still waiting for
   * the user's "confirm" to Claude. Shown as proposed; the widget never sets focus itself.
   */
  proposed: WidgetTask[];
  /** Today and overdue, minus focus and follow-ups. Overdue first. */
  today: WidgetTask[];
  /** Waiting-on items whose follow-up date has arrived. */
  followUps: WidgetTask[];
  doneToday: WidgetTask[];
  inboxCount: number;
  /** Body of today's `## Plan` in the daily note, if written. */
  plan: string | null;
  /** Every list the popover can switch to, in TUI order. */
  lists: ListInfo[];
  pillVisible: boolean;
  /** Set when the vault or config can't be read; everything else is empty then. */
  error: string | null;
}

export interface Result {
  ok: boolean;
  error?: string;
}

/** Where a task can be filed: exactly one of these, or none for the Inbox. */
export interface MoveDest {
  project?: string;
  area?: string;
  someday?: boolean;
}

export interface CapturePreview {
  title: string;
  scheduled: string | null;
}

export interface TaskAppApi {
  getSnapshot(): Promise<Snapshot>;
  getList(id: ListId): Promise<WidgetTask[]>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  complete(id: string): Promise<Result>;
  uncomplete(id: string): Promise<Result>;
  move(id: string, dest: MoveDest): Promise<Result>;
  capture(text: string): Promise<Result>;
  previewCapture(text: string): Promise<CapturePreview>;
  openTask(id: string): Promise<void>;
  openDailyNote(): Promise<void>;
  togglePill(): Promise<void>;
  hideWindow(): void;
  /** Fired each time the capture window is summoned, so it can clear and refocus. */
  onCaptureReset(cb: () => void): () => void;
}

declare global {
  interface Window {
    taskApp: TaskAppApi;
  }
}
