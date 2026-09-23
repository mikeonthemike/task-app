# task-app — how to drive this

This is a Things-style personal task manager. The vault (markdown files, in the
Obsidian [Tasks plugin](https://publish.obsidian.md/tasks/) format) is the source of
truth. There is deliberately **no built-in Anthropic API key and no Google/Slack
OAuth app** — instead, whenever the user asks you (Claude) to capture something,
sync their tasks, or plan their day, you do it directly: parse their text yourself,
call your own already-connected Gmail/Calendar/Slack tools, and drive the vault
through the `task-app` CLI. Don't suggest adding API keys back in; that's an
intentional design choice.

## The CLI is the only way to touch the vault

Never hand-edit the markdown files' task lines yourself (the `🆔`/emoji-field syntax
is easy to get subtly wrong, and the store re-derives project/area from file
location, which a raw edit can silently break). Always shell out to `task-app`.
Run `task-app help` if you need the exact flag syntax. Quick reference:

```bash
task-app add "<title>" [--project P] [--area A] [--due YYYY-MM-DD] \
  [--scheduled YYYY-MM-DD] [--start YYYY-MM-DD] \
  [--priority highest|high|medium|low|lowest] [--recurrence "every week"] \
  [--tag foo] [--tag bar] [--notes "..."] [--someday]

task-app list [inbox|today|overdue|upcoming|anytime|someday|logbook|all|project:<name>|area:<name>] [--json]
task-app complete <id>
task-app uncomplete <id>
task-app edit <id> [--title T] [--due D|none] [--scheduled D|none] [--start D|none] [--priority P|none] [--recurrence R|none] [--tag T]
task-app move <id> [--project P | --area A | --someday | --inbox]
task-app sweep    # relocates completed tasks into Logbook.md; safe to run anytime
```

`list --json` is what you should use when you need to reason about existing tasks
(dedup checks, building a plan, etc.) — it's structured and cheap on context
compared to reading the raw vault files. Use plain `list` (no `--json`) when just
reporting task state back to the user in chat.

Project/area names must match an existing project/area exactly (case-sensitive) or
you'll create a duplicate — run `task-app list all --json` first and check the
`project`/`area` fields on existing tasks, or look at what's under
`<vault>/Tasks/Projects/` and `<vault>/Tasks/Areas/`, before inventing a new one.

## Natural-language capture

When the user says something like "add: call the dentist tomorrow" or pastes a rough
note, don't just dump it through `quickParse` — you're the smart layer now. Resolve
relative dates yourself (today's date is whatever `date` reports), figure out
title vs. project vs. priority, and call `task-app add` with explicit flags. Only
rely on the CLI's own naive date-guessing fallback (chrono-node) as a safety net for
when a human runs `task-app add` directly from a plain terminal without you.

## Pulling in Gmail / Calendar / Slack

You already have authenticated connector tools for these in this session — use them
directly, there's no separate sync module in the app to call. General pattern:

1. Fetch the relevant items (e.g. starred/labeled Gmail messages, today's Calendar
   events, Slack messages reacted with a chosen emoji).
2. Run `task-app list all --json` and check for a tag that marks something as
   already imported (e.g. `#gmail/<messageId>`, `#slack/<ts>`) so you don't
   duplicate on repeat runs.
3. For each new item, call `task-app add` with a title you write (not the raw
   subject line verbatim, unless that's already clean) and a dedup tag via
   `--tag gmail/<messageId>` (or `slack/<ts>`, etc.) so the next run can skip it.
4. Gmail/Slack imports should land in the Inbox (no `--project`/`--area`) unless
   the content clearly maps to an existing project — the user reviews and files
   Inbox items themselves, or asks you to.

This is capture-only for both Gmail and Slack: surface candidates, don't
auto-triage or silently reorganize the user's existing tasks.

## Daily planning

When asked for a daily plan (or if this runs as a scheduled morning task):

1. `task-app list overdue --json` and `task-app list today --json`.
2. Pull today's Calendar events with your Calendar connector.
3. Write the briefing yourself, in chat (or wherever the scheduled task delivers
   it) — there's no `task-app plan` command; you *are* the planning step. Keep it
   short: call out anything overdue or at risk given calendar gaps, suggest a
   realistic focus order, flag if the day is overloaded.

## Vault layout

```
<vault>/Tasks/
  Inbox.md              # unfiled captures
  Someday.md             # backlog, no date
  Logbook.md              # completed tasks, archived here by `task-app sweep`
  Areas/<Name>.md         # area-level tasks with no specific project
  Projects/<Name>.md      # optional frontmatter: `area: <Area name>`
```

A task line: `- [ ] Draft homepage copy 📅 2026-09-30 🔼 🆔 abc126` — the `🆔` field
is the CLI's own stable id; don't remove or duplicate it. Tasks the user types
directly into Obsidian won't have one yet — that's fine, `task-app` assigns and
persists an id for them automatically the next time it scans the vault, so you'll
always see a real, stable id in `list --json` even for those.

Completing a task only flips its checkbox in place — `task-app list logbook` already
shows it regardless of which file it's still sitting in. If you notice Project/Area
files getting cluttered with old `[x]` lines (or the user asks you to tidy up), run
`task-app sweep` to relocate them into `Logbook.md`. It's safe to run proactively;
it's a no-op when there's nothing to sweep.
