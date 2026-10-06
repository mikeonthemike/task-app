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
import { checkVault, cleanTitle, fixVault, type Issue } from "./core/doctor.js";
import { fieldsInTitle, stripTitleFields } from "./core/vault.js";
import { taskJson } from "./core/json.js";
import { estimateTags, focusTags, formatDuration, goalTags, isFocus, MAX_FOCUS, waitingOn, waitingTags } from "./core/meta.js";
import { resolveGoal, updateProjectMeta } from "./core/goals.js";
import { buildReview } from "./core/review.js";
import { dailyNotePath, listSections, previousNoteDate, readNote, readSection, writeSection } from "./core/dailyNote.js";
import { captureNotesToInbox, scanNotes } from "./core/notes.js";
import { todayStr } from "./core/task.js";
import { readFileSync } from "node:fs";

/** `--followup` is an alias for `--scheduled`: a waiting-on task shows up in Today on its follow-up date. */
function scheduledFlag(args: ReturnType<typeof parseArgs>): string | null | undefined {
  const scheduled = args.one("scheduled");
  const followup = args.one("followup");
  if (scheduled !== undefined && followup !== undefined && scheduled !== followup) {
    throw new Error("Pass --scheduled or --followup, not both (--followup is an alias for --scheduled).");
  }
  const value = followup ?? scheduled;
  return nullableDate(value, followup !== undefined ? "followup" : "scheduled");
}

/** Applies --goal / --waiting / --est (each accepting "none") to a tag list. */
function applyMetaFlags(store: TaskStore, tags: string[], args: ReturnType<typeof parseArgs>): string[] {
  let out = tags;
  const goal = args.one("goal");
  if (goal !== undefined) out = goalTags(out, goal === "none" ? null : resolveGoal(store.goals(), goal).name);
  const waiting = args.one("waiting");
  if (waiting !== undefined) out = waitingTags(out, waiting === "none" ? null : waiting);
  const est = args.one("est");
  if (est !== undefined) out = estimateTags(out, est === "none" ? null : est);
  return out;
}

function readStdin(): string {
  if (process.stdin.isTTY) return ""; // nothing piped in; don't block waiting for a keyboard
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Rejects titles carrying CLI output (`[area:Work]`), a flag that didn't parse (`--project`), or
 * a Tasks emoji field (`➕ 2026-10-12`), which would sit in the title instead of acting as a field.
 */
function requireCleanTitle(title: string): string {
  const cleaned = cleanTitle(title);
  if (cleaned !== title.trim()) {
    throw new Error(
      `Title "${title}" contains CLI output or a task-app flag. Did you mean "${cleaned}" with the flag passed separately?`,
    );
  }
  const fields = fieldsInTitle(cleaned);
  if (fields.length) {
    throw new Error(
      `Title "${title}" contains a Tasks field (${fields.join(", ")}). Did you mean "${stripTitleFields(cleaned)}" with the date or value passed as a flag?`,
    );
  }
  return cleaned;
}

function formatIssue(i: Issue): string {
  return `  [${i.kind}] ${i.file}: ${i.message}${i.fix ? `\n      fix: ${i.fix}` : "\n      (needs a manual fix)"}`;
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

  task-app add <title...> [flags]   Add a task. With no flags at all, a date
                                     phrase in the title ("call Sam tomorrow") is
                                     moved into --scheduled (never a past date).
                                     Any flag keeps the title verbatim.
    --literal                         Keep the title verbatim, no date-guessing
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
    --goal <goal>                     Link to a goal in Goals.md (#goal/…)
    --focus                           Make it one of today's top ${MAX_FOCUS}
    --waiting <person>                Waiting on someone (#waiting/…)
    --followup <YYYY-MM-DD>           When to chase it (alias for --scheduled)
    --est <30m|2h|1h30m>              Effort estimate (#est/…)

  task-app list [section] [--json]  Sections: inbox, today, overdue, upcoming,
                                     anytime, someday, logbook, all, focus,
                                     waiting, recurring, project:<name>,
                                     area:<name>, goal:<name>. Default: today.

  task-app complete <id>            Mark a task done. A recurring task (🔁) gets
                                     its next occurrence on the line above, always
                                     after today (missed occurrences are skipped).
  task-app uncomplete <id>          Undo that, removing the untouched next occurrence.
  task-app skip <id>                Move a recurring task to its next occurrence
                                     without completing it (nothing is logged).

  task-app edit <id> [flags]        Update fields in place (doesn't move file).
    --title <text> --due <date|none> --scheduled <date|none> --start <date|none>
    --priority <level|none> --recurrence <text|none> --tag <tag> (repeatable, adds)
    --goal <goal|none> --waiting <person|none> --followup <date|none> --est <dur|none>
    --notes <text> (repeatable, adds a note line; skips one the task already has)

  task-app focus [<id>...] [--force] Set exactly these as today's top ${MAX_FOCUS} (#focus).
    --add <id> | --remove <id> | --clear   No args: show current focus.

  task-app goals [--json]           Goals from Goals.md with open/focus/done counts.
  task-app project <name> [--goal <goal>|none] [--area <area>|none]
                                     Show a project, or set its frontmatter.

  task-app review [--json] [--date D]  Everything a plan or review needs in one
                                     read: focus, overdue, follow-ups, stale
                                     items, goal and project health, estimates.

  task-app note show [--date D] [--section S] [--previous] [--json]
                                     --previous: the latest daily note before D
                                     (with section S, if given).
  task-app note write --section S [--date D] [--text "..."]  (or body on stdin)
                                     Read/replace a "## S" section of the daily
                                     note <vault>/YYYY-MM-DD.md. Other content
                                     in the note is never touched.

  task-app move <id> [flags]        Move a task to a different location.
    --project <name> | --area <name> | --someday | --inbox

  task-app sweep                    Relocate completed tasks into Logbook.md,
                                     tidying up Project/Area files. Safe to run
                                     anytime — doesn't change what "logbook" shows.

  task-app notes [--since D] [--content] [--json]
                                     Your notes (meeting + daily) changed since D
                                     (default today): ## Actions section and the
                                     tasks already captured from each ("From: …").
                                     Read-only. Skips task files and templates.

  task-app capture [--dry-run] [--json]
                                     The sweep of the notes world: adds every
                                     ## Actions bullet from a note into the Inbox,
                                     tagged "From: <name>.md". Only touches a note
                                     with nothing captured from it yet — once
                                     anything has, later changes to that note are
                                     "process my notes" work, not this. --dry-run
                                     previews without writing anything.

  task-app doctor [--fix] [--json]  Check task files for duplicate ids, missing
                                     done dates, junk in titles and misfiled Inbox
                                     items. Read-only unless --fix is given.

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
    const store = new TaskStore(config);

    const input: NewTaskInput = {
      title: requireCleanTitle(args.positional.join(" ")),
      project: args.one("project") ?? null,
      area: args.one("area") ?? null,
      due: nullableDate(args.one("due"), "due") ?? null,
      scheduled: scheduledFlag(args) ?? null,
      start: nullableDate(args.one("start"), "start") ?? null,
      priority: parsePriority(args.one("priority")) ?? null,
      recurrence: args.one("recurrence") ?? null,
      tags: applyMetaFlags(store, args.many("tag").map(normalizeTag), args),
      notes: args.many("notes"),
      someday: args.bool("someday"),
    };
    if (args.bool("focus")) {
      if (store.focus().length >= MAX_FOCUS && !args.bool("force")) {
        throw new Error(`Already ${store.focus().length} focus tasks (cap ${MAX_FOCUS}). Use "task-app focus" to swap one out, or pass --force.`);
      }
      input.tags = focusTags(input.tags ?? [], true);
    }

    // The chrono date-guess is a safety net for a human typing a bare title. Any flag at all means
    // a structured caller (usually an agent) who already chose the dates, so the title stays verbatim.
    if (!Object.keys(args.flags).length) {
      const guess = quickParse(input.title, new Date(), { dateOrder: config.dateOrder });
      if (guess.scheduled || guess.due) {
        input.title = guess.title;
        input.scheduled = guess.scheduled ?? null;
        input.due = guess.due ?? null;
        input.recurrence = guess.recurrence ?? null;
      }
      if (guess.warning) console.error(`Note: ${guess.warning}`);
    }

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
    else if (section === "focus") tasks = store.focus();
    else if (section === "waiting") tasks = store.waiting();
    else if (section === "recurring") tasks = store.recurring();
    else if (section.startsWith("goal:")) {
      const goal = resolveGoal(store.goals(), section.slice("goal:".length));
      tasks = store.all().filter((t) => !t.done && store.goalOf(t) === goal.name);
    }
    else if (section.startsWith("project:")) tasks = store.byProject(section.slice("project:".length));
    else if (section.startsWith("area:")) tasks = store.byArea(section.slice("area:".length));
    else throw new Error(`Unknown section "${section}". See "task-app help".`);

    if (args.bool("json")) {
      console.log(JSON.stringify(tasks.map((t) => taskJson(t, store)), null, 2));
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
    const result = store.completeWithRecurrence(id);
    if (!result) throw new Error(`No task with id "${id}".`);
    console.log(`Completed: ${formatTask(result.task)}`);
    if (result.next) console.log(`Next occurrence: ${formatTask(result.next)}`);
    if (result.unparsedRule) {
      console.log(`Warning: couldn't parse recurrence "${result.task.recurrence}", so no next occurrence was created.`);
    }
    return;
  }

  if (cmd === "uncomplete") {
    const [id] = rest;
    if (!id) throw new Error("Usage: task-app uncomplete <id>");
    const store = new TaskStore(config);
    const result = store.uncompleteWithRecurrence(id);
    if (!result) throw new Error(`No task with id "${id}".`);
    console.log(`Reopened: ${formatTask(result.task)}`);
    if (result.removed) console.log(`Removed its next occurrence: ${formatTask(result.removed)}`);
    return;
  }

  if (cmd === "skip") {
    const [id] = rest;
    if (!id) throw new Error("Usage: task-app skip <id>");
    const store = new TaskStore(config);
    const result = store.skip(id);
    if (!result) throw new Error(`No task with id "${id}".`);
    if (!result.next) throw new Error(`Couldn't parse recurrence "${result.task.recurrence}", so there's no next occurrence to skip to.`);
    console.log(`Skipped to next occurrence: ${formatTask(result.next)}`);
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
    if (args.one("title") !== undefined) patch.title = requireCleanTitle(args.one("title")!);
    const due = nullableDate(args.one("due"), "due");
    if (due !== undefined) patch.due = due;
    const scheduled = scheduledFlag(args);
    if (scheduled !== undefined) patch.scheduled = scheduled;
    const start = nullableDate(args.one("start"), "start");
    if (start !== undefined) patch.start = start;
    const priority = parsePriority(args.one("priority"));
    if (priority !== undefined) patch.priority = priority;
    if (args.one("recurrence") !== undefined) {
      const r = args.one("recurrence")!;
      patch.recurrence = r === "none" ? null : r;
    }
    const tags = applyMetaFlags(store, [...existing.tags, ...args.many("tag").map(normalizeTag)], args);
    if (tags.join(" ") !== existing.tags.join(" ")) patch.tags = tags;

    store.edit(id, patch);
    const task = store.addNotes(id, args.many("notes"));
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

  if (cmd === "focus") {
    const args = parseArgs(rest);
    const store = new TaskStore(config);
    let focus: Task[];
    if (args.bool("clear")) focus = store.setFocus([]);
    else if (args.many("add").length) focus = store.setFocus([...store.focus().map((t) => t.id), ...args.many("add")], args.bool("force"));
    else if (args.many("remove").length) focus = store.setFocus(store.focus().map((t) => t.id).filter((id) => !args.many("remove").includes(id)));
    else if (args.positional.length) focus = store.setFocus(args.positional, args.bool("force"));
    else focus = store.focus();

    if (args.bool("json")) return console.log(JSON.stringify(focus.map((t) => taskJson(t, store)), null, 2));
    if (!focus.length) return console.log("(no focus tasks)");
    focus.forEach((t, i) => console.log(`${i + 1}. ${formatTask(t)}${store.goalOf(t) ? `  → ${store.goalOf(t)}` : ""}`));
    return;
  }

  if (cmd === "goals") {
    const args = parseArgs(rest);
    const store = new TaskStore(config);
    const { goals, horizon, daysToHorizon } = buildReview(config, store);
    if (args.bool("json")) return console.log(JSON.stringify({ horizon, daysToHorizon, goals }, null, 2));
    if (!goals.length) return console.log(`No goals yet. Add "## <Goal>" headings to ${config.tasksDir}/Goals.md.`);
    if (horizon) console.log(`Horizon: ${horizon} (${daysToHorizon} days)\n`);
    for (const g of goals) {
      console.log(`${g.name} — ${g.open} open, ${g.focusToday} in focus, ${g.doneLast7} done in 7 days${g.noActiveTask ? "  ⚠ nothing open" : ""}`);
      if (g.projects.length) console.log(`  projects: ${g.projects.join(", ")}`);
    }
    return;
  }

  if (cmd === "project") {
    const args = parseArgs(rest);
    const name = args.positional.join(" ");
    if (!name) throw new Error("Usage: task-app project <name> [--goal <goal>|none] [--area <area>|none]");
    const store = new TaskStore(config);
    if (!store.projects().includes(name)) {
      throw new Error(`No project named "${name}". Projects: ${store.projects().map((p) => `"${p}"`).join(", ")}.`);
    }
    const goal = args.one("goal");
    const area = args.one("area");
    if (goal !== undefined || area !== undefined) {
      updateProjectMeta(config, name, {
        goal: goal === undefined ? undefined : goal === "none" ? null : resolveGoal(store.goals(), goal).name,
        area: area === undefined ? undefined : area === "none" ? null : area,
      });
      store.refresh();
    }
    const tasks = store.byProject(name);
    console.log(`${name}${store.projectGoal(name) ? `  → goal: ${store.projectGoal(name)}` : "  (no goal)"}`);
    for (const t of tasks) console.log(`  ${formatTask(t)}`);
    return;
  }

  if (cmd === "review") {
    const args = parseArgs(rest);
    const date = nullableDate(args.one("date"), "date") ?? todayStr();
    const store = new TaskStore(config);
    const review = buildReview(config, store, date);
    if (args.bool("json")) return console.log(JSON.stringify(review, null, 2));

    const c = review.counts;
    console.log(`${review.date}: ${c.open} open · ${c.today} today · ${c.overdue} overdue · ${c.inbox} inbox · ${c.waiting} waiting · ${c.doneLast7} done in 7 days`);
    const block = (label: string, items: { id: string; title: string }[]) => {
      if (!items.length) return;
      console.log(`\n${label}:`);
      for (const t of items) console.log(`  - ${t.title} (${t.id})`);
    };
    block("Focus", review.focus);
    block("Overdue", review.overdue);
    block("Due within a week", review.dueSoon);
    block("Follow-ups due", review.waiting.followUpDue);
    block("Waiting with no follow-up date", review.waiting.noFollowUpDate);
    block("Stale in Inbox", review.inbox.filter((t) => t.stale));
    if (review.scheduledPastNoDue.length) {
      console.log("\nPast scheduled date, no due date (overdue in Today, not urgent in the matrix):");
      for (const t of review.scheduledPastNoDue) {
        console.log(`  - ${t.title} (${t.id}) ⏳ ${t.scheduled}, ${t.daysPast} day(s) ago${t.stale ? " (stale)" : ""}`);
      }
    }
    const idle = review.goals.filter((g) => g.noActiveTask).map((g) => g.name);
    if (idle.length) console.log(`\nGoals with nothing open: ${idle.join(", ")}`);
    const stuck = review.projects.filter((p) => p.noNextAction).map((p) => p.name);
    if (stuck.length) console.log(`Projects with no next action: ${stuck.join(", ")}`);
    if (review.estimates.todayMinutes) console.log(`\nEstimated today: ${formatDuration(review.estimates.todayMinutes)}`);
    if (review.vaultIssues.length) console.log(`\n${review.vaultIssues.length} vault issue(s) — run "task-app doctor".`);
    return;
  }

  if (cmd === "note") {
    const [sub, ...noteArgs] = rest;
    const args = parseArgs(noteArgs);
    const section = args.one("section");
    let date = nullableDate(args.one("date"), "date") ?? todayStr();

    if (sub === "show") {
      if (args.bool("previous")) {
        const prev = previousNoteDate(config, date, section);
        if (!prev) {
          if (args.bool("json")) return console.log(JSON.stringify({ date: null, exists: false, sections: {} }));
          console.log(`(no daily note before ${date}${section ? ` with a "## ${section}" section` : ""})`);
          process.exitCode = 2;
          return;
        }
        date = prev;
        if (!args.bool("json")) console.log(`# ${date}\n`);
      }
      if (args.bool("json")) {
        const exists = readNote(config, date) !== null;
        const sections = Object.fromEntries(listSections(config, date).map((name) => [name, readSection(config, date, name)]));
        return console.log(JSON.stringify({ date, path: dailyNotePath(config, date), exists, sections }, null, 2));
      }
      const text = section ? readSection(config, date, section) : readNote(config, date);
      if (text === null) {
        console.log(section ? `(no "## ${section}" section in ${date}.md)` : `(no daily note for ${date})`);
        process.exitCode = 2;
        return;
      }
      console.log(text);
      return;
    }

    if (sub === "write") {
      if (!section) throw new Error('Usage: task-app note write --section <Name> [--date YYYY-MM-DD] [--text "..."] (or pipe the body on stdin)');
      const body = args.one("text") ?? readStdin();
      if (!body.trim()) throw new Error("Nothing to write: pass --text or pipe the section body on stdin.");
      const { path, created } = writeSection(config, date, section, body);
      console.log(`${created ? "Created" : "Updated"} "## ${section}" in ${path}`);
      return;
    }
    throw new Error('Usage: task-app note show|write ... (see "task-app help")');
  }

  if (cmd === "notes") {
    const args = parseArgs(rest);
    const since = nullableDate(args.one("since"), "since") ?? todayStr();
    const store = new TaskStore(config);
    const notes = scanNotes(config, store.all(), { since, includeBody: args.bool("content") });
    if (args.bool("json")) return console.log(JSON.stringify(notes, null, 2));
    if (!notes.length) return console.log(`(no notes changed since ${since})`);
    for (const n of notes) {
      const actions = n.actions ? `${n.actionCount} action(s)` : "no ## Actions";
      console.log(`${n.modified}  ${n.path}  — ${actions}, ${n.captured.length} task(s) captured`);
    }
    return;
  }

  if (cmd === "capture") {
    const args = parseArgs(rest);
    const dryRun = args.bool("dry-run");
    const store = new TaskStore(config);
    const { added, skipped } = captureNotesToInbox(config, store, { dryRun });
    if (args.bool("json")) return console.log(JSON.stringify({ added, skipped }, null, 2));

    if (!added.length) console.log("Nothing to capture — no untouched note has a \"## Actions\" bullet.");
    else {
      console.log(`${dryRun ? "Would capture" : "Captured"} ${added.length} task(s) into Inbox:`);
      for (const a of added) console.log(`  ${a.title}${dryRun ? "" : ` (${a.id})`} — from ${a.from}`);
    }
    if (skipped.length) {
      console.log(`\nLeft alone (already engaged):`);
      for (const s of skipped) console.log(`  ${s.name} — ${s.reason}`);
    }
    return;
  }

  if (cmd === "doctor") {
    const args = parseArgs(rest);
    if (args.bool("fix")) {
      const { fixed, remaining } = fixVault(config);
      if (args.bool("json")) return console.log(JSON.stringify({ fixed, remaining }, null, 2));
      console.log(fixed.length ? `Fixed ${fixed.length} issue(s):` : "Nothing to fix.");
      for (const i of fixed) console.log(formatIssue(i));
      if (remaining.length) {
        console.log(`\n${remaining.length} issue(s) need a manual fix:`);
        for (const i of remaining) console.log(formatIssue(i));
      }
      return;
    }
    const issues = checkVault(config);
    if (args.bool("json")) return console.log(JSON.stringify(issues, null, 2));
    if (!issues.length) return console.log("Vault looks healthy.");
    console.log(`Found ${issues.length} issue(s):`);
    for (const i of issues) console.log(formatIssue(i));
    console.log(`\nRun "task-app doctor --fix" to apply the automatic fixes.`);
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
