import { useState } from "react";
import type { WidgetTask } from "../../shared/api";
import { metaParts } from "./format";
import { useTaskMenu } from "./TaskMenu";

interface Props {
  task: WidgetTask;
  today: string;
  onError: (message: string) => void;
  /** Title only, for the pill. */
  compact?: boolean;
  /** Leave the project/area out of the meta line (the list already says where it is). */
  hideWhere?: boolean;
}

export function TaskRow({ task, today, onError, compact, hideWhere }: Props) {
  // Show the tick straight away; the vault write and rescan follow a moment later.
  const [pending, setPending] = useState(false);
  const openMenu = useTaskMenu();
  const checked = pending ? !task.done : task.done;

  async function toggle() {
    setPending(true);
    const r = task.done ? await window.taskApp.uncomplete(task.id) : await window.taskApp.complete(task.id);
    if (!r.ok) {
      setPending(false);
      onError(r.error ?? "Couldn't update that task.");
    }
  }

  const meta = compact ? [] : metaParts(task, today, hideWhere);
  const repeats = !compact && !!task.recurrence;
  return (
    <li
      className={`row${checked ? " done" : ""}`}
      onContextMenu={
        compact
          ? undefined
          : (e) => {
              e.preventDefault();
              openMenu({ task, x: e.clientX, y: e.clientY });
            }
      }
    >
      <button className={`check${task.focus ? " focus" : ""}`} aria-label={checked ? "Mark not done" : "Mark done"} aria-pressed={checked} onClick={toggle}>
        {checked && (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 6.2 5 8.6 9.5 3.6" />
          </svg>
        )}
      </button>
      <div className="body">
        <button className="title" title="Open in Obsidian" onClick={() => window.taskApp.openTask(task.id)}>
          {task.title}
        </button>

        {(meta.length > 0 || repeats) && (
          <div className="meta">
            {repeats && (
              <span className="repeat" title={`Repeats ${task.recurrence}`} aria-label={`Repeats ${task.recurrence}`}>
                🔁
              </span>
            )}
            {meta.map((m, i) => (
              <span key={i} className={m.urgent ? "urgent" : undefined}>
                {m.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
