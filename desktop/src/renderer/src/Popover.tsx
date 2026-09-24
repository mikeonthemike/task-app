import { useEffect, useState } from "react";
import type { WidgetTask } from "../../shared/api";
import { CaptureInput } from "./Capture";
import { longDate } from "./format";
import { TaskRow } from "./TaskRow";
import { useSnapshot } from "./useSnapshot";

export function Popover() {
  const snap = useSnapshot();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  if (!snap) return null;
  const rows = (tasks: WidgetTask[]) => (
    <ul>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} today={snap.date} onError={setError} />
      ))}
    </ul>
  );

  return (
    <div className="popover">
      <header>
        <div>
          <h1>Today</h1>
          <div className="sub">{longDate(snap.date)}</div>
        </div>
        <div className="actions">
          <button
            className={`icon${snap.pillVisible ? " on" : ""}`}
            title={snap.pillVisible ? "Hide focus pill" : "Show focus pill"}
            aria-pressed={snap.pillVisible}
            onClick={() => window.taskApp.togglePill()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="5" width="13" height="6" rx="3" />
            </svg>
          </button>
          <button className="icon" title="Open today's note in Obsidian" onClick={() => window.taskApp.openDailyNote()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3H3.5v9.5H13V10M9 3h4v4M13 3 7.5 8.5" />
            </svg>
          </button>
        </div>
      </header>

      <main>
        {snap.error ? (
          <div className="banner">{snap.error}</div>
        ) : (
          <>
            <section>
              <h2>Top 3</h2>
              {snap.focus.length ? rows(snap.focus) : <p className="empty">No top 3 yet. Ask Claude to plan your day.</p>}
            </section>

            {snap.plan && (
              <details className="plan">
                <summary>Plan</summary>
                <pre>{snap.plan}</pre>
              </details>
            )}

            {snap.followUps.length > 0 && (
              <section>
                <h2>Follow up</h2>
                {rows(snap.followUps)}
              </section>
            )}

            <section>
              <h2>
                Today <span className="count">{snap.today.length || ""}</span>
              </h2>
              {snap.today.length ? rows(snap.today) : <p className="empty">Nothing else scheduled for today.</p>}
            </section>

            {snap.doneToday.length > 0 && (
              <details className="done-today">
                <summary>Done today · {snap.doneToday.length}</summary>
                {rows(snap.doneToday)}
              </details>
            )}
          </>
        )}
      </main>

      {error && <div className="toast">{error}</div>}

      <footer>
        <CaptureInput today={snap.date} />
        <span className="inbox" title="Items waiting in your Inbox">
          Inbox {snap.inboxCount}
        </span>
      </footer>
    </div>
  );
}
