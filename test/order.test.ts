import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { applyOrder, loadOrder, saveOrder } from "../src/core/order.js";
import { TaskStore } from "../src/core/store.js";

let config: AppConfig;
beforeEach(() => {
  config = { vaultPath: mkdtempSync(join(tmpdir(), "task-app-test-")), tasksDir: "Tasks" };
});
afterEach(() => rmSync(config.vaultPath, { recursive: true, force: true }));

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join("");
const items = ["a", "b", "c", "d"].map((id) => ({ id }));

describe("manual order", () => {
  test("saved ids lead in saved order; new and unknown ids are handled", () => {
    assert.equal(ids(applyOrder(items, ["c", "a"])), "cabd");
    assert.equal(ids(applyOrder(items, ["x", "d", "b"])), "dbac"); // x is gone, ignored
    assert.equal(ids(applyOrder(items, undefined)), "abcd");
  });

  test("round-trips through a hidden file; a bad file means default order", () => {
    saveOrder(config, "inbox", ["b", "a", "b"]);
    assert.deepEqual(loadOrder(config), { inbox: ["b", "a"] });
    writeFileSync(join(config.vaultPath, "Tasks", ".order.json"), "{nope");
    assert.deepEqual(loadOrder(config), {});
  });

  test("setting today's key drops other days', and leaves other lists alone", () => {
    saveOrder(config, "inbox", ["a"]);
    saveOrder(config, "today@2026-11-11", ["a"]);
    saveOrder(config, "today@2026-11-12", ["b"]);
    assert.deepEqual(Object.keys(loadOrder(config)).sort(), ["inbox", "today@2026-11-12"]);
  });

  test("never touches a task file", () => {
    const store = new TaskStore(config);
    const t = store.add({ title: "One" });
    const before = readFileSync(t.location.file, "utf8");
    saveOrder(config, "inbox", [t.id]);
    assert.equal(readFileSync(t.location.file, "utf8"), before);
    assert.ok(existsSync(join(config.vaultPath, "Tasks", ".order.json")));
    assert.equal(new TaskStore(config).all().length, 1);
  });
});
