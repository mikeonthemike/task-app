import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { parseArgs, parseFullEdit, tokenize } from "../src/core/cliArgs.js";
import { quickParse } from "../src/core/quickParse.js";
import { proposedTop3, readSection, writeSection } from "../src/core/dailyNote.js";
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

describe("full edit line", () => {
  test("--notes adds notes and isn't treated as a field to clear", () => {
    const task = { title: "Sit down with Sam", notes: ["From: A.md"] } as Parameters<typeof parseFullEdit>[0];
    const edit = parseFullEdit(task, parseArgs(tokenize('--title "Sit down with Sam" --notes "From: B.md"')));
    assert.deepEqual(edit.notes, ["From: B.md"]);
    assert.deepEqual(parseFullEdit(task, parseArgs(tokenize('--title "Sit down with Sam"'))).notes, []);
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

  test("edit --notes appends note lines after existing ones and skips duplicates", () => {
    cli(["add", "Sit down with Sam", "--area", "Work", "--notes", "From: Intro with Mark.md"]);
    write("Tasks/Areas/Work.md", readFileSync(join(config.vaultPath, "Tasks/Areas/Work.md"), "utf8") + "- [ ] Next task\n");
    const [t] = JSON.parse(cli(["list", "all", "--json"])).filter((x: { title: string }) => x.title === "Sit down with Sam");
    cli(["edit", t.id, "--notes", "From: Intro with Sam.md", "--title", "Sit down with Sam and Alex"]);
    cli(["edit", t.id, "--notes", "From: Intro with Sam.md"]);
    const after = JSON.parse(cli(["list", "all", "--json"]));
    const sam = after.find((x: { id: string }) => x.id === t.id);
    assert.equal(sam.title, "Sit down with Sam and Alex");
    assert.deepEqual(sam.notes, ["From: Intro with Mark.md", "From: Intro with Sam.md"]);
    assert.ok(after.some((x: { title: string }) => x.title === "Next task"));
  });

  test("note write reads the body from stdin", () => {
    cli(["note", "write", "--section", "Plan", "--date", "2026-09-24"], "1. Focus one\n2. Focus two\n");
    assert.equal(cli(["note", "show", "--section", "Plan", "--date", "2026-09-24"]).trim(), "1. Focus one\n2. Focus two");
    const json = JSON.parse(cli(["note", "show", "--date", "2026-09-24", "--json"]));
    assert.equal(json.sections.Plan, "1. Focus one\n2. Focus two");
  });

  test("add with any flag keeps the title verbatim and guesses no date", () => {
    const titles = [
      "Add dry runs (week of 12 Oct), go/no-go checklist and rollout waves to the CRM plan",
      "Confirm the Acme plugin needs no client action; plan weekend cutover cover",
    ];
    cli(["add", titles[0], "--project", "CRM", "--notes", "context"]);
    cli(["add", titles[1], "--tag", "work"]);
    cli(["add", "Book the venue for Friday", "--literal"]);
    const tasks = JSON.parse(cli(["list", "all", "--json"]));
    assert.deepEqual(tasks.map((t: { title: string }) => t.title).sort(), [...titles, "Book the venue for Friday"].sort());
    for (const t of tasks) assert.equal(t.scheduled, null, t.title);
  });

  test("add with no flags still moves a date phrase out of the title", () => {
    cli(["add", "Call Sam tomorrow"]);
    const [t] = JSON.parse(cli(["list", "all", "--json"]));
    assert.equal(t.title, "Call Sam");
    assert.equal(t.scheduled, addDays(todayStr(), 1));
  });

  test("unknown goal is rejected with the valid names", () => {
    assert.throws(() => cli(["add", "X", "--goal", "Nope"]), /Unknown goal "Nope"/);
  });
});

describe("quickParse fallback", () => {
  const monday = new Date(2026, 8, 28, 9, 0); // 2026-09-28

  test("never infers a past date", () => {
    assert.equal(quickParse("plan weekend cutover cover", monday).scheduled, "2026-10-03");
    assert.equal(quickParse("Review the deck friday", monday).scheduled, "2026-10-02");
    assert.equal(quickParse("Send the report yesterday", monday).scheduled, undefined);
    assert.equal(quickParse("Send the report yesterday", monday).title, "Send the report yesterday");
  });

  test("pulls the date out and tidies empty brackets", () => {
    assert.deepEqual(quickParse("Dry runs (12 Oct) for CRM", monday), { title: "Dry runs for CRM", scheduled: "2026-10-12" });
    assert.deepEqual(quickParse("No date here", monday), { title: "No date here" });
  });

  test("a 'by' or 'due' introducing the date goes with it", () => {
    assert.deepEqual(quickParse("Renew passport by friday", monday), { title: "Renew passport", scheduled: "2026-10-02" });
    assert.deepEqual(quickParse("Submit expenses due by 12 Oct", monday), { title: "Submit expenses", scheduled: "2026-10-12" });
    assert.deepEqual(quickParse("Send deck (by 12 Oct) to Sam", monday), { title: "Send deck to Sam", scheduled: "2026-10-12" });
    assert.deepEqual(quickParse("Pass by the shop tomorrow", monday), { title: "Pass by the shop", scheduled: "2026-09-29" });
    assert.deepEqual(quickParse("MOT update every monday by 12 Oct", monday), {
      title: "MOT update",
      recurrence: "every monday",
      scheduled: "2026-10-12",
    });
  });

  test("'end of …' resolves to the last day of that period", () => {
    // monday = 2026-09-28
    assert.deepEqual(quickParse("Report by end of October", monday), { title: "Report", scheduled: "2026-10-31" });
    assert.deepEqual(quickParse("Close the books by the end of the month", monday), { title: "Close the books", scheduled: "2026-09-30" });
    assert.deepEqual(quickParse("Budget end of next month", monday), { title: "Budget", scheduled: "2026-10-31" });
    assert.deepEqual(quickParse("Timesheet EOW", monday), { title: "Timesheet", scheduled: "2026-10-02" });
    assert.deepEqual(quickParse("Plan due end of next week", monday), { title: "Plan", scheduled: "2026-10-09" });
    assert.deepEqual(quickParse("Reply to Sam (EOD)", monday), { title: "Reply to Sam", scheduled: "2026-09-28" });
    assert.deepEqual(quickParse("QBR deck by end of quarter", monday), { title: "QBR deck", scheduled: "2026-09-30" });
    assert.deepEqual(quickParse("Goals end of year", monday), { title: "Goals", scheduled: "2026-12-31" });
    // A month that's already ended this year means next year's.
    assert.deepEqual(quickParse("Renew insurance by end of Feb", monday), { title: "Renew insurance", scheduled: "2027-02-28" });
    assert.deepEqual(quickParse("Tax return end of January 2028", monday), { title: "Tax return", scheduled: "2028-01-31" });
    // At a weekend, "end of week" is the coming Friday.
    assert.equal(quickParse("Timesheet end of week", new Date(2026, 9, 3)).scheduled, "2026-10-09");
    // With a repeat, a month end becomes a month-end rule rather than a drifting day number.
    for (const text of ["Invoice every month by end of month", "Invoice every month on the last day", "Invoice every month end"]) {
      assert.deepEqual(quickParse(text, monday), { title: "Invoice", recurrence: "every month on the last", scheduled: "2026-09-30" }, text);
    }
    assert.deepEqual(quickParse("Board pack every 3 months by end of month", monday), {
      title: "Board pack",
      recurrence: "every 3 months on the last",
      scheduled: "2026-09-30",
    });
    assert.deepEqual(quickParse("Timesheet every week by end of week", monday), {
      title: "Timesheet",
      recurrence: "every friday",
      scheduled: "2026-10-02",
    });
    // No end-of rule for a year: the repeat stays plain and the end-of reader dates it.
    assert.deepEqual(quickParse("Goals review every year by end of year", monday), {
      title: "Goals review",
      recurrence: "every year",
      scheduled: "2026-12-31",
    });
    // "end" on its own is just a word.
    assert.deepEqual(quickParse("Tie up loose ends", monday), { title: "Tie up loose ends" });
  });

  test("a repeat phrase becomes the recurrence, starting on the next matching day", () => {
    // Today matches: starts today, and "monday" isn't read as a one-off date.
    assert.deepEqual(quickParse("MOT status update every monday", monday), {
      title: "MOT status update",
      recurrence: "every monday",
      scheduled: "2026-09-28",
    });
    assert.deepEqual(quickParse("Every Fri timesheet", monday), { title: "timesheet", recurrence: "every friday", scheduled: "2026-10-02" });
    assert.equal(quickParse("Water plants every weekday", new Date(2026, 9, 3)).scheduled, "2026-10-05");
    assert.deepEqual(quickParse("Pay rent every month", monday), { title: "Pay rent", recurrence: "every month", scheduled: "2026-09-28" });
    assert.equal(quickParse("1:1 prep every other week", monday).recurrence, "every 2 weeks");
    assert.equal(quickParse("Backup every 3 days", monday).recurrence, "every 3 days");
    assert.equal(quickParse("Haircut every 6 weeks when done", monday).recurrence, "every 6 weeks when done");
  });

  test("an explicit date sets the first occurrence of a repeat", () => {
    assert.deepEqual(quickParse("MOT status update every monday from 12 Oct", monday), {
      title: "MOT status update",
      recurrence: "every monday",
      scheduled: "2026-10-12",
    });
    assert.deepEqual(quickParse("Board pack every month starting 5 Oct", monday), {
      title: "Board pack",
      recurrence: "every month",
      scheduled: "2026-10-05",
    });
  });

  test("'every' without a rule is just part of the title", () => {
    assert.deepEqual(quickParse("Read every chapter", monday), { title: "Read every chapter" });
    assert.deepEqual(quickParse("Check every page friday", monday), { title: "Check every page", scheduled: "2026-10-02" });
  });
});

describe("proposed top 3", () => {
  test("reads ids from the morning plan's numbered Top 3, ignoring other lists", () => {
    const plan = [
      "_Proposed 08:30. Reply \"confirm\" (or swap one) to set focus._",
      "",
      "**Top 3** (none have estimates, so these times are guesses)",
      "1. Agree WOW with Sam, including R&R on CRM (k3Jd9sQa) · CRM · ~30m",
      "2. Decide on status update (r2tn8wkc) · Status Reporting (not linked yet) · ~1h",
      "3. GitHub access (Pq7x-Lm2) · ~5m",
      "",
      "**Focus blocks (proposed, not booked)**",
      "1. 10:30–11:30 → 2",
    ].join("\n");
    assert.deepEqual(proposedTop3(plan), [["k3Jd9sQa"], ["r2tn8wkc"], ["Pq7x-Lm2"]]);
    assert.deepEqual(proposedTop3("1. No heading (abcd1234)"), []);
  });
});
