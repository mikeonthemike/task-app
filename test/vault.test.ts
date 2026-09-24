import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { checkVault, cleanTitle, fixVault } from "../src/core/doctor.js";
import { TaskStore } from "../src/core/store.js";
import { scanVault, serializeTaskLine, updateTask } from "../src/core/vault.js";

let config: AppConfig;
const root = () => join(config.vaultPath, config.tasksDir);
const read = (rel: string) => readFileSync(join(root(), rel), "utf8");
const write = (rel: string, content: string) => {
  mkdirSync(dirname(join(root(), rel)), { recursive: true });
  writeFileSync(join(root(), rel), content, "utf8");
};
const taskLines = (rel: string) => read(rel).split("\n").filter((l) => l.startsWith("- ["));

beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-test-")), tasksDir: "Tasks" };
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

describe("parsing and serializing", () => {
  test("round-trips every field", () => {
    const line = "- [ ] Draft copy #urgent ⏫ 🔁 every week 🛫 2026-09-01 ⏳ 2026-09-02 📅 2026-09-30 ➕ 2026-08-31 🆔 abc123";
    write("Areas/Work.md", `# Work\n\n${line}\n`);
    const [t] = scanVault(config);
    assert.equal(t.title, "Draft copy");
    assert.equal(t.priority, "high");
    assert.equal(t.recurrence, "every week");
    assert.equal(t.due, "2026-09-30");
    assert.equal(t.area, "Work");
    assert.equal(serializeTaskLine(t), line);
  });

  test("persists an id for a task typed straight into Obsidian", () => {
    write("Inbox.md", "# Inbox\n\n- [ ] Buy milk\n");
    const [first] = scanVault(config);
    const [second] = scanVault(config);
    assert.equal(first.id, second.id);
    assert.match(read("Inbox.md"), new RegExp(`🆔 ${first.id}`));
  });

  test("a read-only scan leaves an id-less line untouched and flags it", () => {
    write("Inbox.md", "# Inbox\n\n- [ ] Buy mi\n");
    const [t] = scanVault(config, { persistIds: false });
    assert.equal(t.idPending, true);
    assert.equal(scanVault(config, { persistIds: false })[0].id, t.id, "temporary id is stable across scans");
    assert.equal(read("Inbox.md"), "# Inbox\n\n- [ ] Buy mi\n");
    const [persisted] = scanVault(config);
    assert.equal(persisted.idPending, undefined);
  });
});

describe("project/area carried by tags", () => {
  test("editing a swept task keeps its project", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Ship it", project: "CRM" });
    store.complete(t.id);
    store.sweep();
    const after = new TaskStore(config);
    after.uncomplete(t.id);
    after.edit(t.id, { title: "Ship it properly" });
    const reread = new TaskStore(config).byId(t.id)!;
    assert.equal(reread.project, "CRM"); // not "Crm", and not dropped
    assert.equal(reread.title, "Ship it properly");
  });

  test("assigning an id to an Obsidian-typed Inbox line keeps its #area tag", () => {
    write("Areas/Work.md", "# Work\n");
    write("Inbox.md", "# Inbox\n\n- [ ] Typed with a tag #area/work\n");
    scanVault(config);
    assert.match(read("Inbox.md"), /#area\/work/);
  });

  test("moving a swept task to another project drops the old project tag", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Ship it", project: "Launch" });
    store.complete(t.id);
    store.sweep();
    new TaskStore(config).move(t.id, { project: "Other" });
    assert.equal(new TaskStore(config).byId(t.id)!.project, "Other");
  });
});

describe("writes with a stale line index", () => {
  test("updates the right line after the file changed underneath", () => {
    const store = new TaskStore(config);
    const a = store.add({ title: "A", area: "Work" });
    store.add({ title: "B", area: "Work" });
    // Simulate an edit in Obsidian after the store scanned: a new line above both tasks.
    write("Areas/Work.md", read("Areas/Work.md").replace("# Work\n", "# Work\n\n- [ ] Typed in Obsidian 🆔 zzz\n"));

    store.complete(a.id);
    const tasks = scanVault(config);
    assert.equal(tasks.find((t) => t.title === "A")!.done, true);
    assert.equal(tasks.find((t) => t.title === "B")!.done, false);
    assert.equal(tasks.find((t) => t.title === "Typed in Obsidian")!.done, false);
  });

  test("refuses to write when the task is gone rather than clobbering another line", () => {
    const store = new TaskStore(config);
    const a = store.add({ title: "A", area: "Work" });
    write("Areas/Work.md", "# Work\n\n- [ ] Something else 🆔 other\n");
    assert.throws(() => updateTask({ ...a, title: "A2" }), /no longer in/);
    assert.match(read("Areas/Work.md"), /Something else/);
  });
});

describe("sweep", () => {
  test("moves completed tasks to the Logbook and keeps project/area as tags", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "Ship it", project: "Launch" });
    store.complete(t.id);
    assert.equal(store.sweep().length, 1);
    assert.equal(taskLines("Projects/Launch.md").length, 0);
    const [logged] = taskLines("Logbook.md");
    assert.match(logged, /#project\/launch/);
    assert.equal(new TaskStore(config).logbook()[0].project, "Launch");
  });

  test("is idempotent, and never duplicates a task already in the Logbook", () => {
    // State left behind by an interrupted sweep: written to the Logbook, not yet deleted.
    write("Areas/Work.md", "# Work\n\n- [x] Done thing ✅ 2026-09-22 🆔 dup1\n");
    write("Logbook.md", "# Logbook\n\n- [x] Done thing #area/work ✅ 2026-09-22 🆔 dup1\n");
    const store = new TaskStore(config);
    store.sweep();
    store.sweep();
    assert.equal(taskLines("Logbook.md").length, 1);
    assert.equal(taskLines("Areas/Work.md").length, 0);
  });
});

describe("doctor", () => {
  test("merges a task written twice, keeping notes and the done date", () => {
    write(
      "Logbook.md",
      [
        "# Logbook",
        "",
        "- [x] Share docs #waiting-on #area/work ➕ 2026-09-22 🆔 7Is",
        "  From: Catch up.md",
        "- [x] Share docs #waiting-on #area/work ✅ 2026-09-22 ➕ 2026-09-22 🆔 7Is",
        "",
      ].join("\n"),
    );
    fixVault(config);
    const tasks = scanVault(config);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].doneDate, "2026-09-22");
    assert.deepEqual(tasks[0].notes, ["From: Catch up.md"]);
  });

  test("gives different tasks that share an id their own ids", () => {
    write("Areas/Work.md", "# Work\n\n- [ ] One 🆔 same\n- [ ] Two 🆔 same\n");
    fixVault(config);
    const ids = scanVault(config).map((t) => t.id);
    assert.equal(new Set(ids).size, 2);
  });

  test("backfills a missing done date, cleans titles, and files tagged Inbox items", () => {
    write("Areas/Work.md", "# Work\n\n- [x] Review paper ➕ 2026-09-22 🆔 a1\n");
    write("Projects/CRM.md", "\n- [ ] Agree WOW with Sam --project  ➕ 2026-09-23 🆔 a2");
    write("Inbox.md", "# Inbox\n\n- [ ] GitHub access [area:Work] #area/work ➕ 2026-09-23 🆔 a3\n");

    const before = checkVault(config).map((i) => i.kind).sort();
    assert.deepEqual(before, ["misfiled-inbox", "missing-done-date", "title-junk", "title-junk"]);

    fixVault(config);
    assert.deepEqual(checkVault(config), []);
    const byId = Object.fromEntries(scanVault(config).map((t) => [t.id, t]));
    assert.equal(byId.a1.doneDate, "2026-09-22");
    assert.equal(byId.a2.title, "Agree WOW with Sam");
    assert.equal(byId.a3.title, "GitHub access");
    assert.equal(byId.a3.area, "Work");
    assert.match(read("Areas/Work.md"), /GitHub access/);
    assert.equal(taskLines("Inbox.md").length, 0);
    assert.equal(new TaskStore(config).byArea("Work").length, 1);
  });

  test("a second --fix is a no-op", () => {
    write("Areas/Work.md", "# Work\n\n- [x] Review paper ➕ 2026-09-22 🆔 a1\n");
    fixVault(config);
    const snapshot = read("Areas/Work.md");
    assert.deepEqual(fixVault(config).fixed, []);
    assert.equal(read("Areas/Work.md"), snapshot);
  });

  test("leaves real titles that merely contain double dashes alone", () => {
    assert.equal(cleanTitle("Document the --verbose option"), "Document the --verbose option");
    assert.equal(cleanTitle("Call Sam [project:CRM]"), "Call Sam");
  });
});
