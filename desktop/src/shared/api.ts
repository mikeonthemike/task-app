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
  pillVisible: boolean;
  /** Set when the vault or config can't be read; everything else is empty then. */
  error: string | null;
}

export interface Result {
  ok: boolean;
  error?: string;
}

export interface CapturePreview {
  title: string;
  scheduled: string | null;
}

export interface TaskAppApi {
  getSnapshot(): Promise<Snapshot>;
  onSnapshot(cb: (s: Snapshot) => void): () => void;
  complete(id: string): Promise<Result>;
  uncomplete(id: string): Promise<Result>;
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
