import { useEffect, useState } from "react";
import type { WidgetTask } from "../../shared/api";
import { TaskRow } from "./TaskRow";

interface Props {
  tasks: WidgetTask[];
  /** Where the order is saved (see the main process); omit for a list the user can't reorder. */
  orderKey?: string;
  today: string;
  onError: (message: string) => void;
  hideWhere?: boolean;
  hideGoal?: boolean;
}

type Drop = { id: string; after: boolean };

/**
 * A list of rows you can drag up and down. Reordering only ever happens inside this one
 * list, never across lists: a row can't be dropped on another list's rows.
 */
export function SortableList({ tasks, orderKey, today, onError, hideWhere, hideGoal }: Props) {
  // Show the new order straight away; the saved order and rescan follow a moment later.
  const [local, setLocal] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  useEffect(() => setLocal(null), [tasks]);

  const shown = local ? local.flatMap((id) => tasks.filter((t) => t.id === id)) : tasks;

  async function commit(from: string, target: Drop) {
    const ids = shown.map((t) => t.id).filter((id) => id !== from);
    const at = ids.indexOf(target.id);
    if (at < 0 || !orderKey) return;
    ids.splice(target.after ? at + 1 : at, 0, from);
    if (ids.every((id, i) => id === shown[i].id)) return;
    setLocal(ids);
    const r = await window.taskApp.setOrder(orderKey, ids);
    if (!r.ok) {
      setLocal(null);
      onError(r.error ?? "Couldn't save that order.");
    }
  }

  return (
    <ul>
      {shown.map((t) => {
        const mark = drop?.id === t.id && drag !== t.id ? (drop.after ? "drop-after" : "drop-before") : "";
        return (
          <TaskRow
            key={t.id}
            task={t}
            today={today}
            onError={onError}
            hideWhere={hideWhere}
            hideGoal={hideGoal}
            className={`${orderKey && shown.length > 1 ? "sortable" : ""} ${drag === t.id ? "dragging" : ""} ${mark}`}
            drag={
              orderKey && shown.length > 1
                ? {
                    draggable: true,
                    onDragStart: (e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", t.id);
                      setDrag(t.id);
                    },
                    onDragOver: (e) => {
                      // Only rows of this list are drop targets, so a drag can't cross lists.
                      if (!drag || !shown.some((x) => x.id === drag)) return;
                      e.preventDefault();
                      const r = e.currentTarget.getBoundingClientRect();
                      const after = e.clientY > r.top + r.height / 2;
                      if (drop?.id !== t.id || drop.after !== after) setDrop({ id: t.id, after });
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      if (drag && drop) void commit(drag, drop);
                      setDrag(null);
                      setDrop(null);
                    },
                    onDragEnd: () => {
                      setDrag(null);
                      setDrop(null);
                    },
                  }
                : undefined
            }
          />
        );
      })}
    </ul>
  );
}
