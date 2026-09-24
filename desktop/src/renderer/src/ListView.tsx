import { useEffect, useState } from "react";
import type { ListId, Snapshot, WidgetTask } from "../../shared/api";
import { TaskRow } from "./TaskRow";

interface Props {
  id: ListId;
  snap: Snapshot;
  onError: (message: string) => void;
}

const EMPTY: Partial<Record<string, string>> = {
  inbox: "Inbox zero.",
  waiting: "Not waiting on anyone.",
  upcoming: "Nothing scheduled ahead.",
  logbook: "Nothing completed yet.",
};

/** Any list other than Today: a flat list, or grouped by project/area for "All open". */
export function ListView({ id, snap, onError }: Props) {
  const [tasks, setTasks] = useState<WidgetTask[] | null>(null);

  // The snapshot changes on every vault write, so it doubles as the refresh signal.
  useEffect(() => {
    let live = true;
    window.taskApp.getList(id).then((t) => live && setTasks(t));
    return () => {
      live = false;
    };
  }, [id, snap]);

  if (!tasks) return null;
  if (!tasks.length) return <p className="empty">{EMPTY[id] ?? "Nothing open here."}</p>;

  const scoped = id.startsWith("project:") || id.startsWith("area:");
  const row = (t: WidgetTask) => <TaskRow key={t.id} task={t} today={snap.date} onError={onError} hideWhere={scoped || id === "all"} />;

  if (id !== "all") return <ul>{tasks.map(row)}</ul>;

  const groups: { name: string; tasks: WidgetTask[] }[] = [];
  for (const t of tasks) {
    const name = t.project ?? t.area ?? "Inbox";
    const last = groups[groups.length - 1];
    if (last?.name === name) last.tasks.push(t);
    else groups.push({ name, tasks: [t] });
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.name}>
          <h2>
            {g.name} <span className="count">{g.tasks.length}</span>
          </h2>
          <ul>{g.tasks.map(row)}</ul>
        </section>
      ))}
    </>
  );
}
