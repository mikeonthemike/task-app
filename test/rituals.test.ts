import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { previousNoteDate, writeSection } from "../src/core/dailyNote.js";
import { scanNotes } from "../src/core/notes.js";
import { nextDate, nextOccurrence } from "../src/core/recurrence.js";
import { TaskStore } from "../src/core/store.js";

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
    assert.deepEqual(nextOccurrence("every week", { start: null, scheduled: "2026-09-21", due: "2026-09-23" }), {
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

  test("completing a recurring task creates the next one above it, without #focus", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Weekly review", area: "Work", recurrence: "every friday", scheduled: "2026-09-25", tags: ["#focus"] });
    const result = store.completeWithRecurrence(t.id)!;
    assert.equal(result.task.done, true);
    assert.equal(result.next!.scheduled, "2026-10-02");
    assert.equal(result.next!.tags.includes("#focus"), false);
    const lines = read("Tasks/Areas/Work.md").split("\n").filter((l) => l.startsWith("- ["));
    assert.match(lines[0], /^- \[ \] Weekly review .*⏳ 2026-10-02/);
    assert.match(lines[1], /^- \[x\] Weekly review .*#focus/);
    // Completing it again is a no-op, not a second occurrence.
    store.completeWithRecurrence(t.id);
    assert.equal(new TaskStore(config).all().length, 2);
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
    assert.equal(sam.projects, "CRM");
    assert.equal(sam.date, "2026-09-23");
    assert.deepEqual(sam.captured.map((c) => c.title), ["Agree WOW with Sam"]);
    assert.equal(notes.find((n) => n.name === "2026-09-23")!.kind, "daily");
  });

  test("--since filters by modification date", () => {
    write("Old.md", "x");
    assert.equal(scanNotes(config, [], { since: "2999-01-01" }).length, 0);
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
