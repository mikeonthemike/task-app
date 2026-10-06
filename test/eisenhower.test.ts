import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { eisenhower } from "../src/core/eisenhower.js";
import { updateProjectMeta } from "../src/core/goals.js";
import { TaskStore } from "../src/core/store.js";
import { addDays, type NewTaskInput } from "../src/core/task.js";

const TODAY = "2026-10-06";
const day = (n: number) => addDays(TODAY, n);

let config: AppConfig;
let store: TaskStore;

beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-test-")), tasksDir: "Tasks" };
  store = new TaskStore(config);
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

const add = (title: string, input: Omit<NewTaskInput, "title"> = {}) => store.add({ title, area: "Work", ...input });
const matrix = () => {
  const m = eisenhower(store.all(), TODAY, config.vaultPath);
  const titles = (ts: { title: string }[]) => ts.map((t) => t.title);
  return {
    doNow: titles(m.doNow),
    schedule: titles(m.schedule),
    delegate: titles(m.delegate),
    question: titles(m.question),
    waiting: titles(m.waiting),
  };
};

describe("eisenhower matrix (mirrors Tasks/Eisenhower.md)", () => {
  test("urgent means due within 3 days, overdue included; scheduled dates don't count", () => {
    add("Overdue", { due: day(-2) });
    add("Due in 3 days", { due: day(3) });
    add("Due in 4 days", { due: day(4) });
    add("Undated");
    add("Past its scheduled date", { scheduled: day(-1) });
    const m = matrix();
    assert.deepEqual(m.delegate, ["Overdue", "Due in 3 days"]);
    assert.deepEqual(m.question.sort(), ["Due in 4 days", "Past its scheduled date", "Undated"]);
  });

  test("important means 🔼 or above, or a direct #goal/ tag; a project's goal doesn't count", () => {
    add("Medium", { priority: "medium" });
    add("Goal tagged", { tags: ["#goal/crm"] });
    add("Normal");
    add("Low", { priority: "low" });
    const inherited = add("In a goal project", { area: null, project: "CRM" });
    updateProjectMeta(config, "CRM", { goal: "CRM" });
    assert.equal(store.goalOf(inherited), "CRM");
    const m = matrix();
    assert.deepEqual(m.schedule.sort(), ["Goal tagged", "Medium"]);
    assert.deepEqual(m.question.sort(), ["In a goal project", "Low", "Normal"]);
  });

  test("each quadrant gets the right tasks, in the note's sort order", () => {
    add("Do later urgent", { priority: "medium", due: day(2) });
    add("Do first urgent", { priority: "highest", due: day(1) });
    add("Same day, lower", { priority: "medium", due: day(1) });
    add("Plan, high", { priority: "high", due: day(20) });
    add("Plan, undated", { priority: "high" });
    add("Quick", { due: day(0) });
    add("Normal maybe");
    add("Low maybe", { priority: "lowest" });
    const m = matrix();
    assert.deepEqual(m.doNow, ["Do first urgent", "Same day, lower", "Do later urgent"]);
    assert.deepEqual(m.schedule, ["Plan, high", "Plan, undated"]);
    assert.deepEqual(m.delegate, ["Quick"]);
    assert.deepEqual(m.question, ["Normal maybe", "Low maybe"]);
  });

  test("leaves out done, Someday and not-yet-started tasks; Inbox items are sorted like any other", () => {
    store.complete(add("Done", { priority: "high" }).id);
    add("Someday", { area: null, someday: true, priority: "high" });
    add("Starts tomorrow", { start: day(1), priority: "high" });
    add("Started today", { start: TODAY, priority: "high" });
    add("Unfiled", { area: null });
    const m = matrix();
    assert.deepEqual(m.schedule, ["Started today"]);
    assert.deepEqual(m.question, ["Unfiled"]);
  });

  test("waiting-on items come out of the quadrants, follow-ups soonest first", () => {
    add("Later", { tags: ["#waiting/sam"], scheduled: day(5), priority: "high", due: day(1) });
    add("No follow-up", { tags: ["#waiting-on"] });
    add("Sooner", { tags: ["#waiting/pat"], scheduled: day(1) });
    const m = matrix();
    assert.deepEqual(m.waiting, ["Sooner", "Later", "No follow-up"]);
    assert.deepEqual([...m.doNow, ...m.schedule, ...m.delegate, ...m.question], []);
  });
});
