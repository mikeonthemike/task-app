import { useEffect, useState } from "react";
import type { Matrix, WidgetTask } from "../../shared/api";
import { longDate } from "./format";
import { TaskMenu, TaskMenuContext, type MenuTarget } from "./TaskMenu";
import { TaskRow } from "./TaskRow";
import { useSnapshot } from "./useSnapshot";

const QUADRANTS: { key: keyof Omit<Matrix, "waiting">; name: string; hint: string; empty: string }[] = [
  { key: "doNow", name: "Do now", hint: "Important · urgent", empty: "Nothing important is pressing." },
  { key: "schedule", name: "Schedule", hint: "Important · not urgent", empty: "Nothing important waiting for a slot." },
  { key: "delegate", name: "Delegate or do fast", hint: "Urgent · not important", empty: "No urgent busywork." },
  { key: "question", name: "Question it", hint: "Neither", empty: "Nothing to question." },
];

/**
 * The Eisenhower popout: the vault's Eisenhower.md, live. Read-only sorting; the only writes are
 * the ones every row already has (tick, and right-click Move, Set date, Set priority). Changing a
 * date or priority re-sorts the task into its new quadrant on the next snapshot.
 */
export function MatrixWindow() {
  const snap = useSnapshot();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  // The snapshot changes on every vault write (and at midnight), so it doubles as the refresh signal.
  useEffect(() => {
    let live = true;
    window.taskApp.getMatrix().then((m) => live && setMatrix(m));
    return () => {
      live = false;
    };
  }, [snap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") window.taskApp.hideWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  if (!snap || !matrix) return null;
  const rows = (tasks: WidgetTask[]) => (
    <ul>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={snap.date} onError={setError} />
      ))}
    </ul>
  );

  return (
    <TaskMenuContext.Provider value={setMenu}>
      <div className="matrix">
        <header>
          <div>
            <h1>Eisenhower</h1>
            <div className="sub">{longDate(snap.date)} · urgent = due within 3 days</div>
          </div>
          <button className="icon" title="Close (Esc)" onClick={() => window.taskApp.hideWindow()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {snap.error ? (
          <div className="banner">{snap.error}</div>
        ) : (
          <div className="grid">
            <div className="axis col c1">Urgent</div>
            <div className="axis col c2">Not urgent</div>
            <div className="axis row-label r1">Important</div>
            <div className="axis row-label r2">Not important</div>
            {QUADRANTS.map((q) => (
              <section key={q.key} className={`quadrant q-${q.key}`}>
                <h2>
                  {q.name} <span className="count">{matrix[q.key].length || ""}</span>
                  <span className="hint">{q.hint}</span>
                </h2>
                <div className="scroll">{matrix[q.key].length ? rows(matrix[q.key]) : <p className="empty">{q.empty}</p>}</div>
              </section>
            ))}
          </div>
        )}

        {matrix.waiting.length > 0 && (
          <details className="waiting">
            <summary>Waiting on someone · {matrix.waiting.length}</summary>
            <div className="scroll">{rows(matrix.waiting)}</div>
          </details>
        )}

        {error && <div className="toast">{error}</div>}
        {menu && <TaskMenu target={menu} lists={snap.lists} today={snap.date} onClose={() => setMenu(null)} onError={setError} />}
      </div>
    </TaskMenuContext.Provider>
  );
}
