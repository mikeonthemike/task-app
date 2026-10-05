import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { previousNoteDate, writeSection } from "../src/core/dailyNote.js";
import { captureNotesToInbox, scanNotes } from "../src/core/notes.js";
import { nextDate, nextOccurrence } from "../src/core/recurrence.js";
import { TaskStore } from "../src/core/store.js";
import { addDays, todayStr } from "../src/core/task.js";

let config: AppConfig;
const read = (rel: string) => readFileSync(join(config.vaultPath, rel), "utf8");
const write = (rel: string, content: string) => {
  mkdirSync(dirname(join(config.vaultPath, rel)), { recursive: true });
  writeFileSync(join(config.vaultPath, rel), content, "utf8");
};

beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-test-")), tasksDir: "Tasks" };
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

describe("recurrence rules", () => {
  test("next dates", () => {
    assert.equal(nextDate("every day", "2026-09-23"), "2026-09-24");
    assert.equal(nextDate("every 3 days", "2026-09-23"), "2026-09-26");
    assert.equal(nextDate("every week", "2026-09-23"), "2026-09-30");
    assert.equal(nextDate("every 2 weeks", "2026-09-23"), "2026-10-07");
    assert.equal(nextDate("every month", "2026-01-31"), "2026-02-28");
    assert.equal(nextDate("every year", "2026-09-23"), "2027-09-23");
    assert.equal(nextDate("every weekday", "2026-09-25"), "2026-09-28"); // Fri → Mon
    assert.equal(nextDate("every friday", "2026-09-23"), "2026-09-25");
    assert.equal(nextDate("every friday", "2026-09-25"), "2026-10-02");
    assert.equal(nextDate("every full moon", "2026-09-23"), null);
  });

  test("dates move together; 'when done' counts from today; no dates → scheduled", () => {
    assert.deepEqual(nextOccurrence("every week", { start: null, scheduled: "2026-09-21", due: "2026-09-23" }, "2026-09-23"), {
      start: null,
      scheduled: "2026-09-28",
      due: "2026-09-30",
    });
    assert.deepEqual(
      nextOccurrence("every week when done", { start: null, scheduled: "2026-09-01", due: null }, "2026-09-23"),
      { start: null, scheduled: "2026-09-30", due: null },
    );
    assert.deepEqual(nextOccurrence("every day", { start: null, scheduled: null, due: null }, "2026-09-23"), {
      start: null,
      scheduled: "2026-09-24",
      due: null,
    });
  });

  test("missed occurrences are skipped: the next one always lands after today", () => {
    const rule = "every monday";
    const late = { start: null, scheduled: "2026-09-14", due: null };
    // Three weeks late on a Wednesday → next Monday, not 21 Sep.
    assert.deepEqual(nextOccurrence(rule, late, "2026-10-07"), { start: null, scheduled: "2026-10-12", due: null });
    // Late, completed on a Monday → next week (the overdue copy stood in for today's).
    assert.deepEqual(nextOccurrence(rule, late, "2026-10-05"), { start: null, scheduled: "2026-10-12", due: null });
    // Done early → just the following week.
    assert.deepEqual(nextOccurrence(rule, { start: null, scheduled: "2026-10-12", due: null }, "2026-10-09"), {
      start: null,
      scheduled: "2026-10-19",
      due: null,
    });
    // catchUp: false is the Tasks plugin's exact result.
    assert.deepEqual(nextOccurrence(rule, late, "2026-10-07", { catchUp: false }), {
      start: null,
      scheduled: "2026-09-21",
      due: null,
    });
    // Offsets between dates survive catch-up.
    assert.deepEqual(nextOccurrence("every week", { start: null, scheduled: "2026-09-14", due: "2026-09-16" }, "2026-10-07"), {
      start: null,
      scheduled: "2026-10-12",
      due: "2026-10-14",
    });
  });

  test("completing a recurring task creates the next one above it, without #focus", () => {
    const store = new TaskStore(config);
    const friday = nextDate("every friday", todayStr())!;
    const t = store.add({ title: "Weekly review", area: "Work", recurrence: "every friday", scheduled: friday, tags: ["#focus"] });
    const result = store.completeWithRecurrence(t.id)!;
    assert.equal(result.task.done, true);
    assert.equal(result.next!.scheduled, addDays(friday, 7));
    assert.equal(result.next!.tags.includes("#focus"), false);
    const lines = read("Tasks/Areas/Work.md").split("\n").filter((l) => l.startsWith("- ["));
    assert.match(lines[0], new RegExp(`^- \\[ \\] Weekly review .*⏳ ${addDays(friday, 7)}`));
    assert.match(lines[1], /^- \[x\] Weekly review .*#focus/);
    // Completing it again is a no-op, not a second occurrence.
    store.completeWithRecurrence(t.id);
    assert.equal(new TaskStore(config).all().length, 2);
  });

  test("completing an overdue recurring task doesn't recreate the missed weeks", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Status update", area: "Work", recurrence: "every week", scheduled: addDays(todayStr(), -21) });
    const result = store.completeWithRecurrence(t.id)!;
    assert.ok(result.next!.scheduled! > todayStr());
    assert.ok(result.next!.scheduled! <= addDays(todayStr(), 7));
    assert.equal(store.overdue().length, 0);
  });

  test("uncomplete removes the untouched next occurrence, but not an edited one", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Status update", area: "Work", recurrence: "every week", scheduled: addDays(todayStr(), -14) });
    const done = store.completeWithRecurrence(t.id)!;
    const back = store.uncompleteWithRecurrence(t.id)!;
    assert.equal(back.task.done, false);
    assert.equal(back.removed!.id, done.next!.id);
    assert.deepEqual(new TaskStore(config).all().map((x) => x.id), [t.id]);

    // Edit the spawned copy: now it's the user's, so it stays.
    const again = store.completeWithRecurrence(t.id)!;
    store.edit(again.next!.id, { scheduled: addDays(again.next!.scheduled!, 1) });
    assert.equal(store.uncompleteWithRecurrence(t.id)!.removed, null);
    assert.equal(new TaskStore(config).all().length, 2);
  });

  test("uncomplete also removes a next occurrence the Tasks plugin made in Obsidian (no catch-up)", () => {
    const today = todayStr();
    const old = addDays(today, -14);
    write(
      "Tasks/Areas/Work.md",
      `# Work\n\n- [ ] Status update 🔁 every week ⏳ ${addDays(old, 7)} 🆔 new1\n- [x] Status update 🔁 every week ⏳ ${old} ✅ ${today} 🆔 old1\n`,
    );
    const store = new TaskStore(config);
    assert.equal(store.uncompleteWithRecurrence("old1")!.removed!.id, "new1");
    assert.deepEqual(new TaskStore(config).all().map((x) => x.id), ["old1"]);
  });

  test("skip moves a recurring task on without logging it, and drops #focus", () => {
    const store = new TaskStore(config);
    const today = todayStr();
    const t = store.add({ title: "Status update", area: "Work", recurrence: "every week", scheduled: today, due: addDays(today, 1), tags: ["#focus"] });
    const result = store.skip(t.id)!;
    assert.equal(result.next!.id, t.id);
    assert.equal(result.next!.scheduled, addDays(today, 7));
    assert.equal(result.next!.due, addDays(today, 8));
    assert.equal(result.next!.tags.includes("#focus"), false);
    const reread = new TaskStore(config);
    assert.equal(reread.all().length, 1);
    assert.equal(reread.logbook().length, 0);
    assert.throws(() => store.skip(store.add({ title: "One-off", area: "Work" }).id), /isn't recurring/);
  });

  test("recurring lists open recurring tasks, soonest first", () => {
    const store = new TaskStore(config);
    const today = todayStr();
    store.add({ title: "Later", area: "Work", recurrence: "every month", scheduled: addDays(today, 20) });
    store.add({ title: "Sooner", area: "Work", recurrence: "every week", scheduled: addDays(today, 2) });
    store.add({ title: "Not recurring", area: "Work", scheduled: today });
    assert.deepEqual(store.recurring().map((t) => t.title), ["Sooner", "Later"]);
  });

  test("an unparseable rule still completes, and reports it", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Odd", area: "Work", recurrence: "every full moon" });
    const result = store.completeWithRecurrence(t.id)!;
    assert.equal(result.task.done, true);
    assert.equal(result.unparsedRule, true);
    assert.equal(new TaskStore(config).all().length, 1);
  });
});

describe("meeting notes scan", () => {
  test("finds ## Actions and already-captured tasks, skipping task files and templates", () => {
    write(".obsidian/templates.json", JSON.stringify({ folder: "templates" }));
    write("templates/Catch Up.md", "## Actions\n- template junk\n");
    write("Intros/Intro with Sam.md", "---\nProjects: CRM\ndate: \"2026-09-23\"\n---\n## Notes\nstuff\n\n## Actions\n- Agree WOW\n- Send deck\n");
    write("2026-09-23.md", "Met with Alex\n");
    const store = new TaskStore(config);
    store.add({ title: "Agree WOW with Sam", project: "CRM", notes: ["From: Intro with Sam.md"] });

    const notes = scanNotes(config, store.all(), { since: "2000-01-01" });
    assert.deepEqual(notes.map((n) => n.path).sort(), ["2026-09-23.md", "Intros/Intro with Sam.md"]);
    const sam = notes.find((n) => n.name === "Intro with Sam")!;
    assert.equal(sam.actions, "- Agree WOW\n- Send deck");
    assert.equal(sam.actionCount, 2);
    assert.equal(sam.projects, "CRM");
    assert.equal(sam.date, "2026-09-23");
    assert.deepEqual(sam.captured.map((c) => c.title), ["Agree WOW with Sam"]);
    assert.equal(notes.find((n) => n.name === "2026-09-23")!.kind, "daily");
  });

  test("actionCount ignores empty bullets, labels and placeholders, matching capture", () => {
    write("Catch up.md", "## Actions\n- [ ] Send deck\n- [ ]\n- [x] Done already\n- set up meetings:\n  - Book room\n- <Insert Actions>\n");
    const note = scanNotes(config, [], { since: "2000-01-01" }).find((n) => n.name === "Catch up")!;
    assert.equal(note.actionCount, 2);
    assert.equal(captureNotesToInbox(config, new TaskStore(config), { dryRun: true }).added.length, 2);
  });

  test("--since filters by modification date", () => {
    write("Old.md", "x");
    assert.equal(scanNotes(config, [], { since: "2999-01-01" }).length, 0);
  });
});

describe("capture notes into inbox", () => {
  test("adds every Actions bullet from an untouched note, skipping label bullets and nested children", () => {
    write(
      "Intro with Jordan.md",
      "## Actions\n- review board paper\n* set up meetings with:\n  - Avery\n  - Blake\n",
    );
    const store = new TaskStore(config);
    const { added, skipped } = captureNotesToInbox(config, store);

    assert.deepEqual(skipped, []);
    assert.deepEqual(
      added.map((a) => a.title),
      ["review board paper", "Avery", "Blake"],
    );
    assert.equal(added.every((a) => a.from === "Intro with Jordan.md"), true);
    assert.deepEqual(
      store.inbox().map((t) => t.title).sort(),
      ["Avery", "Blake", "review board paper"],
    );
    assert.deepEqual(store.byId(added[0].id)!.notes, ["From: Intro with Jordan.md"]);
  });

  test("leaves a note alone once anything has been captured from it, even with new bullets", () => {
    write("Catch up.md", "## Actions\n- already handled\n- brand new one\n");
    const store = new TaskStore(config);
    store.add({ title: "Already handled, reworded", notes: ["From: Catch up.md"] });

    const { added, skipped } = captureNotesToInbox(config, store);
    assert.deepEqual(added, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /already has 1 task\(s\) captured/);
  });

  test("is idempotent: a second run captures nothing further", () => {
    write("Standup.md", "## Actions\n- ship the thing\n");
    const store = new TaskStore(config);
    const first = captureNotesToInbox(config, store);
    assert.equal(first.added.length, 1);

    const second = captureNotesToInbox(config, store);
    assert.deepEqual(second.added, []);
    assert.equal(store.all().length, 1);
  });

  test("handles real checkbox syntax under Actions: strips [ ], skips [x] and empty checkboxes", () => {
    write(
      "Standup notes.md",
      "## Actions\n- [ ] file the expense report\n- [x] already sent the invite\n- [ ]\n",
    );
    const store = new TaskStore(config);
    const { added } = captureNotesToInbox(config, store);
    assert.deepEqual(added.map((a) => a.title), ["file the expense report"]);
  });

  test("skips an unfilled template placeholder", () => {
    write("Acme Dev Model.md", "## Actions\n- [ ] <Insert Actions>\n");
    const store = new TaskStore(config);
    const { added } = captureNotesToInbox(config, store);
    assert.deepEqual(added, []);
  });

  test("dry-run reports what would be added without writing anything", () => {
    write("Planning.md", "## Actions\n- draft the roadmap\n");
    const store = new TaskStore(config);
    const { added } = captureNotesToInbox(config, store, { dryRun: true });

    assert.deepEqual(added.map((a) => a.title), ["draft the roadmap"]);
    assert.equal(store.all().length, 0);
    assert.equal(new TaskStore(config).all().length, 0);
  });

  test("skips notes with no ## Actions section, and task/template files", () => {
    write(".obsidian/templates.json", JSON.stringify({ folder: "templates" }));
    write("templates/Catch Up.md", "## Actions\n- template junk\n");
    write("No actions here.md", "just prose\n");
    const store = new TaskStore(config);
    const { added } = captureNotesToInbox(config, store);
    assert.deepEqual(added, []);
  });
});

describe("previous daily note", () => {
  test("skips days without the section, e.g. across a weekend", () => {
    writeSection(config, "2026-09-24", "Shutdown", "Thu");
    writeSection(config, "2026-09-25", "Shutdown", "Fri");
    write("2026-09-27.md", "Sunday scribbles\n");
    assert.equal(previousNoteDate(config, "2026-09-28", "Shutdown"), "2026-09-25");
    assert.equal(previousNoteDate(config, "2026-09-28"), "2026-09-27");
    assert.equal(previousNoteDate(config, "2026-09-24", "Shutdown"), null);
  });
});
