import { useEffect, useState } from "react";
import type { ListId, WidgetTask } from "../../shared/api";
import { CaptureInput } from "./Capture";
import { longDate } from "./format";
import { ListPicker } from "./ListPicker";
import { ListView } from "./ListView";
import { TaskMenu, TaskMenuContext, type MenuTarget } from "./TaskMenu";
import { TaskRow } from "./TaskRow";
import { useSnapshot } from "./useSnapshot";

export function Popover() {
  const snap = useSnapshot();
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<ListId>("today");
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  // Like h/l in the TUI: ←/→ step through the lists (unless you're typing). Esc backs out.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      const lists = snap?.lists ?? [];
      const i = lists.findIndex((l) => l.id === list);
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && lists.length) {
        const next = lists[(i + (e.key === "ArrowRight" ? 1 : lists.length - 1)) % lists.length];
        setList(next.id);
        setPicking(false);
      } else if (e.key === "Escape") {
        if (picking) setPicking(false);
        else if (list !== "today") setList("today");
        else window.taskApp.hideWindow();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [snap, list, picking]);

  // A project or area that disappears (renamed, emptied and deleted) falls back to Today.
  useEffect(() => {
    if (snap && !snap.lists.some((l) => l.id === list) && !snap.error) setList("today");
  }, [snap, list]);

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

  const current = snap.lists.find((l) => l.id === list);
  const subtitle = current?.kind === "project" ? "Project" : current?.kind === "area" ? "Area" : current?.count ? `${current.count} open` : "";

  return (
    <TaskMenuContext.Provider value={setMenu}>
    <div className="popover">
      <header>
        <div>
          <button className="list-title" aria-expanded={picking} onClick={() => setPicking(!picking)}>
            <h1>{current?.label ?? "Today"}</h1>
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5 5 6.5 8 3.5" />
            </svg>
          </button>
          <div className="sub">{list === "today" ? longDate(snap.date) : subtitle}</div>
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
          <button className="icon" title="Eisenhower matrix" onClick={() => window.taskApp.openMatrix()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <path d="M8 2v12M2 8h12" />
            </svg>
          </button>
          <button className="icon" title="Open today's note in Obsidian" onClick={() => window.taskApp.openDailyNote()}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3H3.5v9.5H13V10M9 3h4v4M13 3 7.5 8.5" />
            </svg>
          </button>
        </div>
      </header>

      <div className="content">
        <main>
          {snap.error ? (
            <div className="banner">{snap.error}</div>
          ) : list !== "today" ? (
            <ListView id={list} snap={snap} onError={setError} />
          ) : (
            <>
              <section>
                <h2>
                  Top 3 {!snap.focus.length && snap.proposed.length > 0 && <span className="badge">Proposed</span>}
                </h2>
                {snap.focus.length ? (
                  rows(snap.focus)
                ) : snap.proposed.length ? (
                  <>
                    {rows(snap.proposed)}
                    <p className="empty">From today's plan. Reply “confirm” to Claude to lock these in.</p>
                  </>
                ) : (
                  <p className="empty">Nothing in your top 3.</p>
                )}
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

        {/* Outside <main> so it stays put over the list, wherever the list is scrolled to. */}
        {picking && (
          <>
            <div className="picker-backdrop" onMouseDown={() => setPicking(false)} />
            <ListPicker
              lists={snap.lists}
              current={list}
              onPick={(id) => {
                setList(id);
                setPicking(false);
              }}
            />
          </>
        )}
      </div>

      {error && <div className="toast">{error}</div>}
      {menu && <TaskMenu target={menu} lists={snap.lists} today={snap.date} onClose={() => setMenu(null)} onError={setError} />}

      <footer>
        <CaptureInput today={snap.date} />
        <span className="inbox" title="Items waiting in your Inbox">
          Inbox {snap.inboxCount}
        </span>
      </footer>
    </div>
    </TaskMenuContext.Provider>
  );
}
