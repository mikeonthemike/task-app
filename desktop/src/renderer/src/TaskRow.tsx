import { useState } from "react";
import type { WidgetTask } from "../../shared/api";
import { metaParts } from "./format";

interface Props {
  task: WidgetTask;
  today: string;
  onError: (message: string) => void;
  /** Title only, for the pill. */
  compact?: boolean;
}

export function TaskRow({ task, today, onError, compact }: Props) {
  // Show the tick straight away; the vault write and rescan follow a moment later.
  const [pending, setPending] = useState(false);
  const checked = pending ? !task.done : task.done;

  async function toggle() {
    setPending(true);
    const r = task.done ? await window.taskApp.uncomplete(task.id) : await window.taskApp.complete(task.id);
    if (!r.ok) {
      setPending(false);
      onError(r.error ?? "Couldn't update that task.");
    }
  }

  const meta = compact ? [] : metaParts(task, today);
  return (
    <li className={`row${checked ? " done" : ""}`}>
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
        {meta.length > 0 && (
          <div className="meta">
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
