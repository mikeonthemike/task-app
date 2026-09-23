import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { parseArgs } from "../src/core/cliArgs.js";
import { readSection, writeSection } from "../src/core/dailyNote.js";
import { loadGoals, resolveGoal, updateProjectMeta } from "../src/core/goals.js";
import { estimateTags, focusTags, parseDuration, waitingOn, waitingTags } from "../src/core/meta.js";
import { buildReview } from "../src/core/review.js";
import { TaskStore } from "../src/core/store.js";
import { addDays, todayStr } from "../src/core/task.js";

let config: AppConfig;
const root = () => join(config.vaultPath, config.tasksDir);
const read = (rel: string) => readFileSync(join(config.vaultPath, rel), "utf8");
const write = (rel: string, content: string) => {
  mkdirSync(dirname(join(config.vaultPath, rel)), { recursive: true });
  writeFileSync(join(config.vaultPath, rel), content, "utf8");
};

const GOALS = `---
horizon: 2026-12-18
---
# Goals

Intro text is ignored.

## CRM
Migration readiness plan agreed.

## Status Reporting
Weekly RAG digest.
`;

beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-test-")), tasksDir: "Tasks" };
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

describe("tag metadata", () => {
  test("parses durations", () => {
    assert.equal(parseDuration("30m"), 30);
    assert.equal(parseDuration("2h"), 120);
    assert.equal(parseDuration("1h30m"), 90);
    assert.equal(parseDuration("1.5h"), 90);
    assert.equal(parseDuration("45"), 45);
    assert.equal(parseDuration("soon"), null);
    assert.deepEqual(estimateTags(["#x"], "90m"), ["#x", "#est/1h30m"]);
    assert.throws(() => estimateTags([], "soon"), /--est/);
  });

  test("waiting tags replace each other and the legacy #waiting-on", () => {
    const tags = waitingTags(["#waiting-on", "#waiting/bob"], "Pat O'Neil");
    assert.deepEqual(tags, ["#waiting/pat-o-neil"]);
    assert.equal(waitingOn({ tags } as never), "Pat O Neil");
    assert.equal(waitingOn({ tags: ["#waiting-on"] } as never), "");
    assert.equal(waitingOn({ tags: [] } as never), null);
  });

  test("#focus is matched exactly", () => {
    assert.deepEqual(focusTags(["#focus-time"], true), ["#focus-time", "#focus"]);
    assert.deepEqual(focusTags(["#focus-time", "#focus"], false), ["#focus-time"]);
  });

  test("boolean flags don't swallow the next argument", () => {
    const args = parseArgs(["--focus", "Call", "Sam", "--est", "30m", "--someday"]);
    assert.deepEqual(args.positional, ["Call", "Sam"]);
    assert.equal(args.one("est"), "30m");
    assert.ok(args.bool("focus") && args.bool("someday"));
  });
});

describe("goals", () => {
  test("parses Goals.md headings and horizon", () => {
    write("Tasks/Goals.md", GOALS);
    const { horizon, goals } = loadGoals(config);
    assert.equal(horizon, "2026-12-18");
    assert.deepEqual(goals.map((g) => g.name), ["CRM", "Status Reporting"]);
    assert.equal(goals[1].description, "Weekly RAG digest.");
    assert.equal(resolveGoal(goals, "status reporting").name, "Status Reporting");
    assert.throws(() => resolveGoal(goals, "Nope"), /Unknown goal "Nope"\. Goals: "CRM", "Status Reporting"/);
  });

  test("tasks inherit their project's goal; a #goal tag overrides it", () => {
    write("Tasks/Goals.md", GOALS);
    const store = new TaskStore(config);
    const a = store.add({ title: "Readiness checklist", project: "CRM" });
    const b = store.add({ title: "Draft digest", project: "CRM", tags: ["#goal/status-reporting"] });
    updateProjectMeta(config, "CRM", { goal: "CRM" });
    store.refresh();
    assert.equal(store.goalOf(store.byId(a.id)!), "CRM");
    assert.equal(store.goalOf(store.byId(b.id)!), "Status Reporting");
  });

  test("updating project frontmatter keeps the body and other keys", () => {
    write("Tasks/Projects/CRM.md", "---\narea: Work\n---\n\n# CRM\n\n- [ ] Task 🆔 t1\n");
    updateProjectMeta(config, "CRM", { goal: "CRM" });
    const content = read("Tasks/Projects/CRM.md");
    assert.match(content, /area: Work/);
    assert.match(content, /goal: CRM/);
    assert.match(content, /- \[ \] Task 🆔 t1/);
    updateProjectMeta(config, "CRM", { goal: null });
    assert.doesNotMatch(read("Tasks/Projects/CRM.md"), /goal:/);
  });

  test("sweep bakes the project's goal into the Logbook line", () => {
    write("Tasks/Goals.md", GOALS);
    write("Tasks/Projects/CRM.md", "---\ngoal: CRM\n---\n\n# CRM\n");
    const store = new TaskStore(config);
    const t = store.add({ title: "Ship", project: "CRM" });
    store.complete(t.id);
    store.sweep();
    assert.match(read("Tasks/Logbook.md"), /#goal\/crm/);
    updateProjectMeta(config, "CRM", { goal: null });
    const after = new TaskStore(config);
    assert.equal(after.goalOf(after.byId(t.id)!), "CRM");
  });
});

describe("focus", () => {
  test("setFocus replaces the set, caps at 3, and focus shows in Today", () => {
    const store = new TaskStore(config);
    const ids = ["a", "b", "c", "d"].map((title) => store.add({ title, area: "Work" }).id);
    store.setFocus(ids.slice(0, 2));
    assert.deepEqual(store.focus().map((t) => t.title), ["a", "b"]);
    store.setFocus([ids[2]]);
    assert.deepEqual(new TaskStore(config).focus().map((t) => t.title), ["c"]);
    assert.deepEqual(store.today().map((t) => t.title), ["c"]);
    assert.throws(() => store.setFocus(ids), /cap is 3/);
    assert.equal(store.setFocus(ids, true).length, 4);
  });
});

describe("daily note sections", () => {
  test("creates the note, then replaces only its own section", () => {
    const date = "2026-09-24";
    writeSection(config, date, "Plan", "1. First");
    assert.equal(read(`${date}.md`), "## Plan\n\n1. First\n");

    // The user writes their own notes around it in Obsidian.
    write(`${date}.md`, `Met with Alex\n- notes\n\n${read(`${date}.md`)}\n## Notes\nmine\n`);
    writeSection(config, date, "Plan", "1. Revised\n2. Second");
    writeSection(config, date, "Shutdown", "Done: 2/3");

    const note = read(`${date}.md`);
    assert.match(note, /^Met with Alex\n- notes\n/);
    assert.match(note, /## Plan\n\n1\. Revised\n2\. Second\n\n## Notes\nmine/);
    assert.doesNotMatch(note, /First/);
    assert.match(note, /## Shutdown\n\nDone: 2\/3\n$/);
    assert.equal(readSection(config, date, "plan"), "1. Revised\n2. Second");
    assert.equal(readSection(config, date, "Missing"), null);
  });

  test("honours dailyNotesDir", () => {
    config.dailyNotesDir = "Daily";
    writeSection(config, "2026-09-24", "Plan", "x");
    assert.match(read("Daily/2026-09-24.md"), /## Plan/);
  });
});

describe("review", () => {
  test("surfaces follow-ups, idle goals, stuck projects and stale inbox items", () => {
    write("Tasks/Goals.md", GOALS);
    write("Tasks/Projects/CRM.md", "---\ngoal: CRM\n---\n\n# CRM\n");
    write("Tasks/Projects/Empty.md", "# Empty\n");
    const today = todayStr();
    const store = new TaskStore(config);
    store.add({ title: "CRM plan", project: "CRM", tags: ["#est/1h", "#focus"] });
    store.add({ title: "Chase Morgan", area: "Work", tags: ["#waiting/morgan"], scheduled: today });
    store.add({ title: "Hear back from Sam", area: "Work", tags: ["#waiting/sam"] });
    write("Tasks/Inbox.md", `# Inbox\n\n- [ ] Old capture ➕ ${addDays(today, -5)} 🆔 old1\n`);
    store.refresh();

    const r = buildReview(config, store, today);
    assert.deepEqual(r.focus.map((t) => t.title), ["CRM plan"]);
    assert.equal(r.focus[0].goal, "CRM");
    assert.deepEqual(r.waiting.followUpDue.map((t) => t.title), ["Chase Morgan"]);
    assert.deepEqual(r.waiting.noFollowUpDate.map((t) => t.waitingOn), ["Sam"]);
    assert.equal(r.goals.find((g) => g.name === "Status Reporting")!.noActiveTask, true);
    assert.equal(r.goals.find((g) => g.name === "CRM")!.focusToday, 1);
    assert.equal(r.projects.find((p) => p.name === "Empty")!.noNextAction, true);
    assert.equal(r.inbox[0].stale, true);
    assert.equal(r.estimates.focusMinutes, 60);
    assert.equal(r.daysToHorizon !== null, true);
  });
});

describe("CLI end to end", () => {
  // Runs the real CLI with HOME pointed at a temp dir, so it never sees the real config.
  const cli = (args: string[], input?: string) =>
    execFileSync(process.execPath, ["--import", "tsx", "src/cli.tsx", ...args], {
      env: { ...process.env, HOME: config.vaultPath },
      input,
      encoding: "utf8",
    });

  beforeEach(() => {
    write(".config/task-app/config.json", JSON.stringify({ vaultPath: config.vaultPath, tasksDir: "Tasks" }));
    write("Tasks/Goals.md", GOALS);
  });

  test("add with meta flags, then list focus/waiting as JSON", () => {
    cli(["add", "--focus", "Draft CRM plan", "--goal", "crm", "--est", "45m", "--area", "Work"]);
    cli(["add", "GitHub access", "--waiting", "Morgan", "--followup", "2026-09-26", "--area", "Work"]);
    const [focus] = JSON.parse(cli(["list", "focus", "--json"]));
    assert.equal(focus.title, "Draft CRM plan");
    assert.equal(focus.goal, "CRM");
    assert.equal(focus.estimateMinutes, 45);
    const [waiting] = JSON.parse(cli(["list", "waiting", "--json"]));
    assert.equal(waiting.waitingOn, "Morgan");
    assert.equal(waiting.scheduled, "2026-09-26");
  });

  test("edit clears meta with none", () => {
    cli(["add", "Thing", "--waiting", "Sam", "--est", "1h", "--area", "Work"]);
    const [t] = JSON.parse(cli(["list", "all", "--json"]));
    cli(["edit", t.id, "--waiting", "none", "--est", "none"]);
    const [after] = JSON.parse(cli(["list", "all", "--json"]));
    assert.equal(after.waitingOn, null);
    assert.equal(after.estimateMinutes, null);
  });

  test("note write reads the body from stdin", () => {
    cli(["note", "write", "--section", "Plan", "--date", "2026-09-24"], "1. Focus one\n2. Focus two\n");
    assert.equal(cli(["note", "show", "--section", "Plan", "--date", "2026-09-24"]).trim(), "1. Focus one\n2. Focus two");
    const json = JSON.parse(cli(["note", "show", "--date", "2026-09-24", "--json"]));
    assert.equal(json.sections.Plan, "1. Focus one\n2. Focus two");
  });

  test("unknown goal is rejected with the valid names", () => {
    assert.throws(() => cli(["add", "X", "--goal", "Nope"]), /Unknown goal "Nope"/);
  });
});
