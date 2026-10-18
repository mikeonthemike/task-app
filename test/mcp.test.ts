import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { addTask, dailyNote, goalsSummary, listTasks, reviewTasks } from "../src/mcp/tools.js";

let config: AppConfig;
const root = () => join(config.vaultPath, config.tasksDir);
const write = (rel: string, content: string) => {
  mkdirSync(dirname(join(root(), rel)), { recursive: true });
  writeFileSync(join(root(), rel), content, "utf8");
};

beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-mcp-")), tasksDir: "Tasks" };
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

describe("add_task", () => {
  test("lands in the Inbox by default and keeps the title verbatim", () => {
    const t = addTask(config, { title: "Call the dentist tomorrow", scheduled: "2026-10-20", priority: "high" });
    assert.equal(t.title, "Call the dentist tomorrow");
    assert.equal(t.scheduled, "2026-10-20");
    assert.equal(t.priority, "high");
    assert.deepEqual(listTasks(config, "inbox").tasks.map((x) => x.id), [t.id]);
    assert.match(readFileSync(join(root(), "Inbox.md"), "utf8"), /Call the dentist tomorrow/);
  });

  test("rejects an unknown project instead of creating a duplicate", () => {
    write("Projects/Website.md", "# Website\n");
    assert.throws(() => addTask(config, { title: "x", project: "website" }), /No project named "website".*"Website"/);
    assert.equal(addTask(config, { title: "x", project: "Website" }).project, "Website");
  });

  test("rejects a Tasks emoji field or CLI flag in the title", () => {
    assert.throws(() => addTask(config, { title: "Pay rent 📅 2026-10-31" }), /Tasks field/);
    assert.throws(() => addTask(config, { title: "Pay rent --due 2026-10-31" }), /task-app flag/);
  });

  test("applies waiting, estimate and tags", () => {
    const t = addTask(config, { title: "Contract", waiting: "Sam", est: "30m", tags: ["gmail/abc"] });
    assert.equal(t.waitingOn, "Sam");
    assert.equal(t.estimateMinutes, 30);
    assert.ok(t.tags.includes("#gmail/abc"));
  });
});

describe("read tools", () => {
  test("list_tasks sections, limit and unknown section", () => {
    for (let i = 0; i < 3; i++) addTask(config, { title: `t${i}` });
    const r = listTasks(config, "inbox", 2);
    assert.equal(r.total, 3);
    assert.equal(r.tasks.length, 2);
    assert.equal(r.truncated, true);
    assert.throws(() => listTasks(config, "nonsense"), /Unknown section/);
  });

  test("review, goals and daily_note work on a near-empty vault", () => {
    addTask(config, { title: "one" });
    assert.equal(reviewTasks(config, "2026-10-19").counts.inbox, 1);
    assert.deepEqual(goalsSummary(config).goals, []);
    write("../2026-10-19.md", "# Day\n\n## Plan\n1. one\n");
    assert.match(String(dailyNote(config, "2026-10-19", "Plan").text), /one/);
    assert.equal(dailyNote(config, "2026-10-18").exists, false);
  });
});
