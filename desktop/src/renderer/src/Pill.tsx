import { useEffect, useState } from "react";
import { TaskRow } from "./TaskRow";
import { useSnapshot } from "./useSnapshot";

/** Always-on-top strip showing one focus task at a time. Drag it anywhere. */
export function Pill() {
  const snap = useSnapshot();
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Before the user confirms, show the plan's proposal rather than an empty pill.
  const isProposal = !!snap && !snap.focus.length && snap.proposed.length > 0;
  const focus = (isProposal ? snap?.proposed : snap?.focus) ?? [];

  // Completing a task shrinks the list; stay in range.
  useEffect(() => {
    if (index >= focus.length) setIndex(Math.max(0, focus.length - 1));
  }, [focus.length, index]);

  if (!snap) return null;
  const task = focus[index];
  return (
    <div className="pill" title={error ?? undefined}>
      {task && isProposal && <span className="badge" title="Proposed in today's plan, not confirmed yet">Proposed</span>}
      {task ? (
        <ul>
          <TaskRow key={task.id} task={task} today={snap.date} onError={setError} compact />
        </ul>
      ) : (
        <span className="empty">{snap.error ? "Can't read the vault" : "No top 3 yet"}</span>
      )}
      {focus.length > 1 && (
        <button className="step" title={isProposal ? "Next proposed task" : "Next focus task"} onClick={() => setIndex((index + 1) % focus.length)}>
          {index + 1}/{focus.length}
        </button>
      )}
      <button className="close" title="Hide focus pill" onClick={() => window.taskApp.togglePill()}>
        ×
      </button>
    </div>
  );
}
