#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { addTask, dailyNote, DEFAULT_LIST_LIMIT, goalsSummary, listTasks, reviewTasks } from "./tools.js";

/** Runs a handler against the current config and wraps the result (or error) as MCP tool output. */
function run(fn: () => unknown) {
  try {
    return { content: [{ type: "text" as const, text: JSON.stringify(fn(), null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
  }
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").optional();

const server = new McpServer(
  { name: "task-app", version: "0.1.0" },
  {
    instructions:
      "Tasks live in the user's Obsidian vault. Use list_tasks for questions about what's on their plate, " +
      "review for a planning overview, and add_task to capture something (it goes to the Inbox unless a project/area is given). " +
      "Resolve relative dates ('tomorrow', 'Friday') to YYYY-MM-DD yourself before calling add_task. " +
      "This server is read-mostly: it cannot complete, edit or move tasks.",
  },
);

// loadConfig runs per call so a changed vault path in ~/.config/task-app is picked up without a restart.
server.registerTool(
  "list_tasks",
  {
    description:
      "List tasks in one section. Sections: inbox, today, overdue, upcoming, anytime, someday, logbook, all, focus (today's top 3), " +
      "waiting, recurring, project:<name>, area:<name>, goal:<name>. Each task has id, title, due/scheduled dates, priority, project/area/goal, tags and notes.",
    inputSchema: {
      section: z.string().default("today").describe("Section name, e.g. today, inbox, project:Website"),
      limit: z.number().int().min(1).max(500).default(DEFAULT_LIST_LIMIT).describe("Max tasks returned; `truncated` says if more exist"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ section, limit }) => run(() => listTasks(loadConfig(), section, limit)),
);

server.registerTool(
  "review",
  {
    description:
      "One read of everything a plan or review needs: focus, today, overdue, due within 7 days, Inbox (with staleness), waiting-on follow-ups, " +
      "goal and project health, stale tasks, estimate totals, the last 7 days of completions and vault issues.",
    inputSchema: { date },
    annotations: { readOnlyHint: true },
  },
  ({ date }) => run(() => reviewTasks(loadConfig(), date)),
);

server.registerTool(
  "goals",
  {
    description: "The user's goals with open / in-focus / done-in-7-days counts and linked projects.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => run(() => goalsSummary(loadConfig())),
);

server.registerTool(
  "daily_note",
  {
    description: "Read a day's note (default today): its sections such as Plan, Meetings and Shutdown, or one section's text.",
    inputSchema: { date, section: z.string().optional().describe("Section name without '##', e.g. Plan") },
    annotations: { readOnlyHint: true },
  },
  ({ date, section }) => run(() => dailyNote(loadConfig(), date, section)),
);

server.registerTool(
  "add_task",
  {
    description:
      "Capture a task. Lands in the Inbox unless project, area or someday is set. The title is stored verbatim, so put dates in due/scheduled " +
      "(YYYY-MM-DD), never in the title. Check list_tasks inbox first if a duplicate is likely. project and area must already exist.",
    inputSchema: {
      title: z.string().min(1).describe("Clean task title, no dates or flags in it"),
      project: z.string().optional(),
      area: z.string().optional(),
      due: date.describe("Hard deadline, YYYY-MM-DD"),
      scheduled: date.describe("When it should appear in Today, YYYY-MM-DD; also the follow-up date for a waiting-on task"),
      priority: z.enum(["highest", "high", "medium", "low", "lowest"]).optional().describe("Importance, not urgency; omit for normal"),
      tags: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
      waiting: z.string().optional().describe("Person this is waiting on, if someone else owes the user something"),
      est: z.string().optional().describe("Effort estimate like 30m, 2h, 1h30m"),
      goal: z.string().optional().describe("Existing goal name"),
      someday: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  (args) => run(() => addTask(loadConfig(), args)),
);

// stdout carries the protocol, so anything diagnostic must go to stderr.
await server.connect(new StdioServerTransport());
