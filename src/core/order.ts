import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import { writeFileAtomic } from "./vault.js";

/**
 * Manual ordering for the widget's lists. A list like Today is computed from many files, so
 * there is no file position to reorder; instead each list (or group within one) has a key
 * and a saved array of task ids. It lives beside the tasks in a hidden file, so the task
 * lines themselves are never touched and the vault watcher ignores it.
 *
 * Keys for a single day's lists carry `@YYYY-MM-DD`; setting one drops every other day's.
 */
const FILE = ".order.json";

type OrderFile = Record<string, string[]>;

const orderPath = (config: AppConfig) => join(config.vaultPath, config.tasksDir, FILE);

export function loadOrder(config: AppConfig): OrderFile {
  const path = orderPath(config);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: OrderFile = {};
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
    return out;
  } catch {
    return {}; // a half-synced or hand-mangled file just means default order
  }
}

export function saveOrder(config: AppConfig, key: string, ids: string[]): void {
  const all = loadOrder(config);
  const day = /@(\d{4}-\d{2}-\d{2})$/.exec(key)?.[1];
  if (day) {
    for (const k of Object.keys(all)) {
      const d = /@(\d{4}-\d{2}-\d{2})$/.exec(k)?.[1];
      if (d && d !== day) delete all[k];
    }
  }
  all[key] = [...new Set(ids)];
  mkdirSync(join(config.vaultPath, config.tasksDir), { recursive: true });
  writeFileAtomic(orderPath(config), JSON.stringify(all, null, 2) + "\n");
}

/** Saved ids first, in saved order; anything not saved (new tasks) follows in its default order. */
export function applyOrder<T extends { id: string }>(items: T[], saved: string[] | undefined): T[] {
  if (!saved?.length) return items;
  const rank = new Map(saved.map((id, i) => [id, i]));
  const known = items.filter((t) => rank.has(t.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...known, ...items.filter((t) => !rank.has(t.id))];
}
