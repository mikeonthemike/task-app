import type { ListId, ListInfo } from "../../shared/api";

interface Props {
  lists: ListInfo[];
  current: ListId;
  onPick: (id: ListId) => void;
}

const GROUPS: { kind: ListInfo["kind"]; heading: string | null }[] = [
  { kind: "view", heading: null },
  { kind: "project", heading: "Projects" },
  { kind: "area", heading: "Areas" },
];

/** Drops down from the header title: every list, grouped like the TUI's order. */
export function ListPicker({ lists, current, onPick }: Props) {
  return (
    <nav className="picker" aria-label="Lists">
      {GROUPS.map(({ kind, heading }) => {
        const items = lists.filter((l) => l.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind}>
            {heading && <h2>{heading}</h2>}
            <ul>
              {items.map((l) => (
                <li key={l.id}>
                  <button className={l.id === current ? "current" : undefined} aria-current={l.id === current} onClick={() => onPick(l.id)}>
                    <span>{l.label}</span>
                    {l.count ? <span className="count">{l.count}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
