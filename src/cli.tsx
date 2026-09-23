#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import React from "react";
import { render } from "ink";
import { App } from "./tui/App.js";
import { configExists, configPath, loadConfig, saveConfig, type AppConfig } from "./config.js";
import { TaskStore } from "./core/store.js";
import type { NewTaskInput, Task } from "./core/task.js";
import { quickParse } from "./core/quickParse.js";
import { formatTask, nullableDate, normalizeTag, parseArgs, parsePriority } from "./core/cliArgs.js";

function toJson(t: Task) {
  return {
    id: t.id,
    title: t.title,
    done: t.done,
    doneDate: t.doneDate,
    priority: t.priority,
    scheduled: t.scheduled,
    due: t.due,
    start: t.start,
    created: t.created,
    recurrence: t.recurrence,
    tags: t.tags,
    project: t.project,
    area: t.area,
    someday: t.someday,
    notes: t.notes,
  };
}

async function ask(rl: ReturnType<typeof createInterface>, question: string, fallback = ""): Promise<string> {
  const answer = (await rl.question(fallback ? `${question} [${fallback}] ` : `${question} `)).trim();
  return answer || fallback;
}

async function runInit(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("task-app setup\n");

  const existing = configExists() ? loadConfig() : undefined;
  const vaultPath = await ask(rl, "Path to your Obsidian vault:", existing?.vaultPath ?? "");
  if (!existsSync(vaultPath)) {
    console.warn(`Warning: ${vaultPath} does not exist yet — it will be used anyway.`);
  }
  const tasksDir = await ask(rl, "Subfolder inside the vault for tasks:", existing?.tasksDir ?? "Tasks");
  rl.close();

  const config: AppConfig = { vaultPath, tasksDir };
  saveConfig(config);
  console.log(`\nSaved config to ${configPath()}.`);
  console.log("Run `task-app` to launch the TUI, or see `task-app help` for scriptable commands.");
}

function printHelp(): void {
  console.log(`task-app — a Things-style task manager backed by your Obsidian vault.

Usage:
  task-app                          Launch the interactive TUI.
  task-app init                     Set up (or update) the vault path.

  task-app add <title...> [flags]   Add a task.
    --project <name>                 File under Tasks/Projects/<name>.md
    --area <name>                    File under Tasks/Areas/<name>.md
    --due <YYYY-MM-DD>                Hard deadline
    --scheduled <YYYY-MM-DD>          When it should appear in Today
    --start <YYYY-MM-DD>              Start-on date
    --priority <highest|high|medium|low|lowest>
    --recurrence <text>               e.g. "every week"
    --tag <tag>                       Repeatable, e.g. --tag gmail --tag urgent
    --notes <text>                    Repeatable
    --someday                         File into Someday.md instead

  task-app list [section] [--json]  Sections: inbox, today, overdue, upcoming,
                                     anytime, someday, logbook, all,
                                     project:<name>, area:<name>. Default: today.

  task-app complete <id>            Mark a task done.
  task-app uncomplete <id>          Undo that.

  task-app edit <id> [flags]        Update fields in place (doesn't move file).
    --title <text> --due <date|none> --scheduled <date|none> --start <date|none>
    --priority <level|none> --recurrence <text|none> --tag <tag> (repeatable, adds)

  task-app move <id> [flags]        Move a task to a different location.
    --project <name> | --area <name> | --someday | --inbox

  task-app sweep                    Relocate completed tasks into Logbook.md,
                                     tidying up Project/Area files. Safe to run
                                     anytime — doesn't change what "logbook" shows.

  task-app help                     Show this message.
`);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === "init") return runInit();
  if (cmd === "help" || cmd === "--help" || cmd === "-h") return printHelp();

  if (!configExists()) {
    console.log("No config found. Running setup first...\n");
    await runInit();
  }
  const config = loadConfig();

  if (cmd === "add") {
    const args = parseArgs(rest);
    if (!args.positional.length) throw new Error("Usage: task-app add <title...> [flags]");

    const input: NewTaskInput = {
      title: args.positional.join(" "),
      project: args.one("project") ?? null,
      area: args.one("area") ?? null,
      due: nullableDate(args.one("due"), "due") ?? null,
      scheduled: nullableDate(args.one("scheduled"), "scheduled") ?? null,
      start: nullableDate(args.one("start"), "start") ?? null,
      priority: parsePriority(args.one("priority")) ?? null,
      recurrence: args.one("recurrence") ?? null,
      tags: args.many("tag").map(normalizeTag),
      notes: args.many("notes"),
      someday: args.bool("someday"),
    };

    if (!input.due && !input.scheduled && !input.start) {
      const guess = quickParse(input.title);
      if (guess.scheduled) {
        input.title = guess.title;
        input.scheduled = guess.scheduled;
      }
    }

    const store = new TaskStore(config);
    const task = store.add(input);
    console.log(`Added: ${formatTask(task)}`);
    return;
  }

  if (cmd === "list") {
    const args = parseArgs(rest);
    const section = args.positional[0] ?? "today";
    const store = new TaskStore(config);

    let tasks: Task[];
    if (section === "inbox") tasks = store.inbox();
    else if (section === "today") tasks = store.today();
    else if (section === "overdue") tasks = store.overdue();
    else if (section === "upcoming") tasks = store.upcoming();
    else if (section === "anytime") tasks = store.anytime();
    else if (section === "someday") tasks = store.someday();
    else if (section === "logbook") tasks = store.logbook();
    else if (section === "all") tasks = store.all();
    else if (section.startsWith("project:")) tasks = store.byProject(section.slice("project:".length));
    else if (section.startsWith("area:")) tasks = store.byArea(section.slice("area:".length));
    else throw new Error(`Unknown section "${section}". See "task-app help".`);

    if (args.bool("json")) {
      console.log(JSON.stringify(tasks.map(toJson), null, 2));
    } else if (!tasks.length) {
      console.log("(nothing here)");
    } else {
      for (const t of tasks) console.log(formatTask(t));
    }
    return;
  }

  if (cmd === "complete") {
    const [id] = rest;
    if (!id) throw new Error("Usage: task-app complete <id>");
    const store = new TaskStore(config);
    const task = store.complete(id);
    if (!task) throw new Error(`No task with id "${id}".`);
    console.log(`Completed: ${formatTask(task)}`);
    return;
  }

  if (cmd === "uncomplete") {
    const [id] = rest;
    if (!id) throw new Error("Usage: task-app uncomplete <id>");
    const store = new TaskStore(config);
    const task = store.uncomplete(id);
    if (!task) throw new Error(`No task with id "${id}".`);
    console.log(`Reopened: ${formatTask(task)}`);
    return;
  }

  if (cmd === "edit") {
    const [id, ...flagArgs] = rest;
    if (!id) throw new Error("Usage: task-app edit <id> [flags]");
    const args = parseArgs(flagArgs);
    const store = new TaskStore(config);
    const existing = store.byId(id);
    if (!existing) throw new Error(`No task with id "${id}".`);

    const patch: Partial<Task> = {};
    if (args.one("title") !== undefined) patch.title = args.one("title");
    const due = nullableDate(args.one("due"), "due");
    if (due !== undefined) patch.due = due;
    const scheduled = nullableDate(args.one("scheduled"), "scheduled");
    if (scheduled !== undefined) patch.scheduled = scheduled;
    const start = nullableDate(args.one("start"), "start");
    if (start !== undefined) patch.start = start;
    const priority = parsePriority(args.one("priority"));
    if (priority !== undefined) patch.priority = priority;
    if (args.one("recurrence") !== undefined) {
      const r = args.one("recurrence")!;
      patch.recurrence = r === "none" ? null : r;
    }
    if (args.many("tag").length) {
      patch.tags = [...existing.tags, ...args.many("tag").map(normalizeTag)];
    }

    const task = store.edit(id, patch);
    console.log(`Updated: ${formatTask(task!)}`);
    return;
  }

  if (cmd === "sweep") {
    const store = new TaskStore(config);
    const moved = store.sweep();
    if (!moved.length) console.log("Nothing to sweep — no completed tasks outside Logbook.md.");
    else {
      console.log(`Swept ${moved.length} completed task(s) into Logbook.md:`);
      for (const t of moved) console.log(`  ${formatTask(t)}`);
    }
    return;
  }

  if (cmd === "move") {
    const [id, ...flagArgs] = rest;
    if (!id) throw new Error("Usage: task-app move <id> [--project name | --area name | --someday | --inbox]");
    const args = parseArgs(flagArgs);
    const store = new TaskStore(config);
    if (!store.byId(id)) throw new Error(`No task with id "${id}".`);

    if (!args.bool("project") && !args.bool("area") && !args.bool("someday") && !args.bool("inbox")) {
      throw new Error("Specify a destination: --project <name>, --area <name>, --someday, or --inbox.");
    }
    const dest = args.bool("inbox")
      ? { project: null, area: null, someday: false }
      : { project: args.one("project") ?? null, area: args.one("area") ?? null, someday: args.bool("someday") };

    const task = store.move(id, dest);
    console.log(`Moved: ${formatTask(task!)}`);
    return;
  }

  if (cmd) throw new Error(`Unknown command "${cmd}". See "task-app help".`);

  render(<App config={config} />);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
