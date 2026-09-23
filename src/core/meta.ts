import type { Task } from "./task.js";
import { slugify } from "./task.js";

/**
 * Daily-driver metadata lives in plain tags so it round-trips through Obsidian and the
 * Tasks plugin untouched:
 *   #focus               one of today's top 3
 *   #waiting/<person>    delegated / waiting on someone; its ⏳ scheduled date is the follow-up
 *   #est/<duration>      effort estimate, e.g. #est/30m, #est/1h30m
 *   #goal/<slug>         links a task to a goal directly (otherwise it inherits its project's goal)
 */
export const FOCUS_TAG = "#focus";
export const MAX_FOCUS = 3;
const LEGACY_WAITING_TAG = "#waiting-on";

export function isFocus(t: Task): boolean {
  return t.tags.includes(FOCUS_TAG);
}

/** The person being waited on, "" if waiting on someone unnamed (legacy #waiting-on), null if not waiting. */
export function waitingOn(t: Task): string | null {
  const tag = t.tags.find((x) => x.startsWith("#waiting/"));
  if (tag) {
    return tag
      .slice("#waiting/".length)
      .split("-")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  }
  return t.tags.includes(LEGACY_WAITING_TAG) ? "" : null;
}

export function estimateMinutes(t: Task): number | null {
  const tag = t.tags.find((x) => x.startsWith("#est/"));
  return tag ? parseDuration(tag.slice("#est/".length)) : null;
}

export function goalSlugTag(t: Task): string | null {
  const tag = t.tags.find((x) => x.startsWith("#goal/"));
  return tag ? tag.slice("#goal/".length) : null;
}

/** "30m" | "2h" | "1h30m" | "90" (minutes) → minutes. Returns null if unparseable. */
export function parseDuration(text: string): number | null {
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m?)?$/i.exec(text.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const minutes = Math.round(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  return minutes > 0 ? minutes : null;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h}h${m}m` : h ? `${h}h` : `${m}m`;
}

/** Replaces every tag starting with `prefix` by `replacement` (or just removes them when null). */
export function withTag(tags: string[], prefix: string, replacement: string | null): string[] {
  const kept = tags.filter((t) => !t.startsWith(prefix));
  return replacement ? [...kept, replacement] : kept;
}

export function focusTags(tags: string[], on: boolean): string[] {
  const kept = tags.filter((t) => t !== FOCUS_TAG); // exact match: leave e.g. #focus-time alone
  return on ? [...kept, FOCUS_TAG] : kept;
}

/** null clears. Also drops the legacy #waiting-on tag so a task never carries both. */
export function waitingTags(tags: string[], person: string | null): string[] {
  const cleared = withTag(tags.filter((t) => t !== LEGACY_WAITING_TAG), "#waiting/", null);
  return person ? [...cleared, `#waiting/${slugify(person)}`] : cleared;
}

export function estimateTags(tags: string[], est: string | null): string[] {
  if (est === null) return withTag(tags, "#est/", null);
  const minutes = parseDuration(est);
  if (minutes === null) throw new Error(`--est must look like 30m, 2h or 1h30m, got "${est}".`);
  return withTag(tags, "#est/", `#est/${formatDuration(minutes)}`);
}

export function goalTags(tags: string[], goalName: string | null): string[] {
  return withTag(tags, "#goal/", goalName ? `#goal/${slugify(goalName)}` : null);
}
