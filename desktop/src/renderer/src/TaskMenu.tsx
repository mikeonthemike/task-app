import { createContext, useContext, useEffect, useState } from "react";
import type { ListInfo, MoveDest, WidgetTask } from "../../shared/api";

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

interface Props {
  target: MenuTarget;
  lists: ListInfo[];
  onClose: () => void;
  onError: (message: string) => void;
}

/** Right-click menu for a task. Only "Move" so far: it opens the sections, and clicking one moves. */
export function TaskMenu({ target, lists, onClose, onError }: Props) {
  const [step, setStep] = useState<"actions" | "sections">("actions");
  const { task } = target;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (step === "sections") setStep("actions");
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
        {step === "actions" ? (
          <button role="menuitem" onClick={() => setStep("sections")}>
            <span>Move</span>
            <span aria-hidden="true">›</span>
          </button>
        ) : (
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
