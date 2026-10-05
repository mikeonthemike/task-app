import { createContext, useContext, useEffect, useState } from "react";
import type { ListInfo, MoveDest, Priority, TaskPatch, WidgetTask } from "../../shared/api";
import { addDays, nextWeekday, relativeDate } from "./format";

export interface MenuTarget {
  task: WidgetTask;
  x: number;
  y: number;
}

/** Rows call this on right-click; the Popover owns the one open menu. */
export const TaskMenuContext = createContext<(target: MenuTarget) => void>(() => {});
export const useTaskMenu = () => useContext(TaskMenuContext);

const MENU_W = 200;
const EDGE = 6;

/** Where each section files a task; the Inbox is "no project, no area". */
function destOf(l: ListInfo): MoveDest | null {
  if (l.kind === "project") return { project: l.id.slice("project:".length) };
  if (l.kind === "area") return { area: l.id.slice("area:".length) };
  if (l.id === "inbox") return {};
  if (l.id === "someday") return { someday: true };
  return null;
}

function isCurrent(t: WidgetTask, l: ListInfo): boolean {
  if (l.kind === "project") return t.project === l.id.slice("project:".length);
  if (l.kind === "area") return !t.project && t.area === l.id.slice("area:".length);
  return false;
}

type DateField = "scheduled" | "due";

/** Same emoji the Tasks plugin writes; normal has none. */
const PRIORITIES: { value: Priority | null; label: string; mark: string }[] = [
  { value: "highest", label: "Highest", mark: "🔺" },
  { value: "high", label: "High", mark: "⏫" },
  { value: "medium", label: "Medium", mark: "🔼" },
  { value: null, label: "Normal", mark: "" },
  { value: "low", label: "Low", mark: "🔽" },
  { value: "lowest", label: "Lowest", mark: "⏬" },
];

interface Props {
  target: MenuTarget;
  lists: ListInfo[];
  today: string;
  onClose: () => void;
  onError: (message: string) => void;
}

/** Right-click menu for a task: Move, Set date and Set priority, each opening its own list. */
export function TaskMenu({ target, lists, today, onClose, onError }: Props) {
  const [step, setStep] = useState<"actions" | "sections" | "date" | "priority">("actions");
  const { task } = target;
  // Edit the date the task already uses: its due date if it has one, otherwise when it starts.
  const [field, setField] = useState<DateField>(task.due ? "due" : "scheduled");
  const [picked, setPicked] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (step !== "actions") setStep("actions");
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, onClose]);

  async function move(dest: MoveDest) {
    onClose();
    const r = await window.taskApp.move(task.id, dest);
    if (!r.ok) onError(r.error ?? "Couldn't move that task.");
  }

  async function edit(patch: TaskPatch) {
    onClose();
    const r = await window.taskApp.edit(task.id, patch);
    if (!r.ok) onError(r.error ?? "Couldn't update that task.");
  }

  const current = task[field];
  const other = field === "due" ? task.scheduled : task.due;
  // A repeating task counts from its date, so it can't lose its last one.
  const canClear = !!current && !(task.recurrence && !other);
  const dateChoices = [
    { label: "Today", date: today, hint: false },
    { label: "Tomorrow", date: addDays(today, 1), hint: false },
    { label: "This weekend", date: nextWeekday(addDays(today, -1), 6), hint: true },
    { label: "Next week", date: nextWeekday(today, 1), hint: true },
  ];

  const sections = lists.flatMap((l) => {
    const dest = destOf(l);
    return dest ? [{ l, dest }] : [];
  });
  const groups = [
    { heading: null, items: sections.filter((s) => s.l.kind === "view") },
    { heading: "Projects", items: sections.filter((s) => s.l.kind === "project") },
    { heading: "Areas", items: sections.filter((s) => s.l.kind === "area") },
  ];

  const left = Math.max(EDGE, Math.min(target.x, window.innerWidth - MENU_W - EDGE));
  const top = Math.max(EDGE, Math.min(target.y, window.innerHeight - EDGE - 40));
  const maxHeight = window.innerHeight - top - EDGE;

  return (
    <>
      <div
        className="menu-backdrop"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="menu" role="menu" style={{ left, top, width: MENU_W, maxHeight }}>
        {step === "actions" && (
          <>
            <button role="menuitem" onClick={() => setStep("sections")}>
              <span>Move</span>
              <span aria-hidden="true">›</span>
            </button>
            <button role="menuitem" onClick={() => setStep("date")}>
              <span>Set date</span>
              <span aria-hidden="true">›</span>
            </button>
            <button role="menuitem" onClick={() => setStep("priority")}>
              <span>Set priority</span>
              <span aria-hidden="true">›</span>
            </button>
          </>
        )}
        {step === "date" && (
          <>
            <div className="menu-segments" role="group" aria-label="Which date">
              {(["scheduled", "due"] as const).map((f) => (
                <button key={f} aria-pressed={field === f} className={field === f ? "on" : undefined} onClick={() => setField(f)}>
                  {f === "scheduled" ? "When" : "Due"}
                </button>
              ))}
            </div>
            {current && <div className="menu-title">{`${field === "due" ? "Due" : "Starts"} ${relativeDate(current, today)}`}</div>}
            {dateChoices.map(({ label, date, hint }) => (
              <button key={label} role="menuitem" disabled={date === current} onClick={() => edit({ [field]: date })}>
                <span>{label}</span>
                <span className="menu-hint">{date === current ? "✓" : hint ? relativeDate(date, today) : ""}</span>
              </button>
            ))}
            <form
              className="menu-date"
              onSubmit={(e) => {
                e.preventDefault();
                if (picked) edit({ [field]: picked });
              }}
            >
              <input type="date" aria-label="Pick a date" value={picked || current || ""} onChange={(e) => setPicked(e.target.value)} />
              <button type="submit" disabled={!picked || picked === current}>
                Set
              </button>
            </form>
            <button
              role="menuitem"
              disabled={!canClear}
              title={current && !canClear ? "A repeating task needs a date to count from." : undefined}
              onClick={() => edit({ [field]: null })}
            >
              <span>{field === "due" ? "No due date" : "No start date"}</span>
            </button>
          </>
        )}
        {step === "priority" && (
          <>
            <div className="menu-title">Priority (importance)</div>
            {PRIORITIES.map(({ value, label, mark }) => {
              const here = (task.priority ?? null) === value;
              return (
                <button key={label} role="menuitem" disabled={here} onClick={() => edit({ priority: value })}>
                  <span>
                    <span className="menu-mark" aria-hidden="true">
                      {mark}
                    </span>
                    {label}
                  </span>
                  {here && <span aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </>
        )}
        {step === "sections" && (
          <>
            <div className="menu-title">Move to…</div>
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <div key={g.heading ?? "views"}>
                    {g.heading && <h2>{g.heading}</h2>}
                    {g.items.map(({ l, dest }) => {
                      const here = isCurrent(task, l);
                      return (
                        <button key={l.id} role="menuitem" disabled={here} onClick={() => move(dest)}>
                          <span>{l.label}</span>
                          {here && <span aria-hidden="true">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                ),
            )}
          </>
        )}
      </div>
    </>
  );
}
