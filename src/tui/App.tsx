import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { AppConfig } from "../config.js";
import { TaskStore } from "../core/store.js";
import type { Task } from "../core/task.js";
import { quickParse } from "../core/quickParse.js";
import { parseArgs, parseFullEdit, tokenize } from "../core/cliArgs.js";
import { estimateMinutes, formatDuration, isFocus, waitingOn } from "../core/meta.js";

type Section =
  | { kind: "inbox" }
  | { kind: "today" }
  | { kind: "focus" }
  | { kind: "waiting" }
  | { kind: "upcoming" }
  | { kind: "anytime" }
  | { kind: "someday" }
  | { kind: "logbook" }
  | { kind: "project"; name: string }
  | { kind: "area"; name: string };

function sectionLabel(s: Section): string {
  switch (s.kind) {
    case "inbox": return "Inbox";
    case "today": return "Today";
    case "focus": return "Focus";
    case "waiting": return "Waiting";
    case "upcoming": return "Upcoming";
    case "anytime": return "Anytime";
    case "someday": return "Someday";
    case "logbook": return "Logbook";
    case "project": return s.name;
    case "area": return s.name;
  }
}

function tasksFor(store: TaskStore, s: Section): Task[] {
  switch (s.kind) {
    case "inbox": return store.inbox();
    case "today": return store.today();
    case "focus": return store.focus();
    case "waiting": return store.waiting();
    case "upcoming": return store.upcoming();
    case "anytime": return store.anytime();
    case "someday": return store.someday();
    case "logbook": return store.logbook();
    case "project": return store.byProject(s.name);
    case "area": return store.byArea(s.name);
  }
}

function priorityMark(t: Task): string {
  switch (t.priority) {
    case "highest": return "🔺";
    case "high": return "⏫";
    case "medium": return "🔼";
    case "low": return "🔽";
    case "lowest": return "⏬";
    default: return " ";
  }
}

function dateLabel(t: Task): string {
  const d = t.due ?? t.scheduled;
  return d ? d : "";
}

/** Renders a task's current fields as an editable `--flag value` line, matching `task-app edit`/`move` syntax. */
function editPrefill(t: Task): string {
  const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const parts = [`--title ${quote(t.title)}`];
  if (t.due) parts.push(`--due ${t.due}`);
  if (t.scheduled) parts.push(`--scheduled ${t.scheduled}`);
  if (t.start) parts.push(`--start ${t.start}`);
  if (t.priority) parts.push(`--priority ${t.priority}`);
  if (t.recurrence) parts.push(`--recurrence ${quote(t.recurrence)}`);
  if (t.project) parts.push(`--project ${quote(t.project)}`);
  else if (t.area) parts.push(`--area ${quote(t.area)}`);
  if (t.someday) parts.push(`--someday`);
  return parts.join(" ");
}

export function App({ config }: { config: AppConfig }) {
  const { exit } = useApp();
  const [store] = useState(() => new TaskStore(config));
  const [, forceRender] = useState(0);
  const rerender = () => forceRender((n) => n + 1);

  const sections: Section[] = useMemo(
    () => [
      { kind: "inbox" },
      { kind: "today" },
      { kind: "focus" },
      { kind: "waiting" },
      { kind: "upcoming" },
      { kind: "anytime" },
      { kind: "someday" },
      { kind: "logbook" },
      ...store.projects().map((name) => ({ kind: "project" as const, name })),
      ...store.areas().map((name) => ({ kind: "area" as const, name })),
    ],
    [store],
  );

  const [sectionIndex, setSectionIndex] = useState(1); // start on "Today"
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<"list" | "adding" | "editing">("list");
  const [draft, setDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [status, setStatus] = useState("");

  const section = sections[sectionIndex];
  const tasks = tasksFor(store, section);

  useInput((input, key) => {
    if (mode === "adding" || mode === "editing") {
      if (key.escape) {
        setStatus("");
        setMode("list");
      }
      return; // otherwise TextInput handles its own input; submit via onSubmit below.
    }

    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (key.leftArrow || input === "h") {
      setSectionIndex((i) => Math.max(0, i - 1));
      setCursor(0);
    } else if (key.rightArrow || input === "l") {
      setSectionIndex((i) => Math.min(sections.length - 1, i + 1));
      setCursor(0);
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(tasks.length - 1, c + 1));
    } else if (input === " " || key.return) {
      const task = tasks[cursor];
      if (task) {
        store.complete(task.id);
        rerender();
      }
    } else if (input === "a") {
      setDraft("");
      setStatus("");
      setMode("adding");
    } else if (input === "e") {
      const task = tasks[cursor];
      if (task) {
        setEditDraft(editPrefill(task));
        setStatus("");
        setMode("editing");
      }
    } else if (input === "x") {
      const moved = store.sweep();
      setStatus(moved.length ? `Swept ${moved.length} completed task(s) into Logbook.` : "Nothing to sweep.");
      rerender();
    }
  });

  const submitDraft = (text: string) => {
    setMode("list");
    if (!text.trim()) return;
    const input = quickParse(text);
    store.add(input);
    setStatus(`Added: ${input.title}`);
    rerender();
  };

  const submitEdit = (text: string) => {
    setMode("list");
    const task = tasks[cursor];
    if (!task) return;
    try {
      const args = parseArgs(tokenize(text));
      const { fieldPatch, dest } = parseFullEdit(task, args);
      store.edit(task.id, fieldPatch);
      if (dest.project !== task.project || dest.area !== task.area || dest.someday !== task.someday) {
        store.move(task.id, dest);
      }
      setStatus(`Updated: ${fieldPatch.title}`);
    } catch (err) {
      setStatus(`Edit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    rerender();
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box>
        {sections.map((s, i) => (
          <Box key={i} marginRight={2}>
            <Text bold={i === sectionIndex} color={i === sectionIndex ? "cyan" : undefined} inverse={i === sectionIndex}>
              {sectionLabel(s)}
            </Text>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {tasks.length === 0 && <Text dimColor>Nothing here.</Text>}
        {tasks.map((t, i) => (
          <Text key={t.id} inverse={i === cursor}>
            {t.done ? "✅" : "⬜"} {isFocus(t) ? "★" : priorityMark(t)} {t.title}
            {waitingOn(t) !== null ? `  ⌛${waitingOn(t) || "waiting"}` : ""}
            {estimateMinutes(t) ? `  ~${formatDuration(estimateMinutes(t)!)}` : ""}
            {dateLabel(t) ? `  (${dateLabel(t)})` : ""}
            {t.project ? `  [${t.project}]` : ""}
            {"  "}
            <Text dimColor>[{t.id}]</Text>
          </Text>
        ))}
      </Box>

      {mode === "adding" && (
        <Box marginTop={1}>
          <Text color="green">+ </Text>
          <TextInput value={draft} onChange={setDraft} onSubmit={submitDraft} />
        </Box>
      )}

      {mode === "editing" && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="yellow">edit&gt; </Text>
            <TextInput value={editDraft} onChange={setEditDraft} onSubmit={submitEdit} />
          </Box>
          <Text dimColor>
            --title --due --scheduled --start --priority --recurrence --project --area --someday
            (delete a flag to clear it) · Esc to cancel
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {status ||
            "a add · e edit · space/enter complete · h/l switch list · j/k move · x sweep logbook · q quit"}
        </Text>
      </Box>
    </Box>
  );
}
