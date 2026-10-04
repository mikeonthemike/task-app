# task-app — how to drive this

These instructions are for any coding agent working in this repo (Claude Code, Codex,
Cursor, Gemini CLI, …). Claude is the recommended agent, but nothing here depends on it.

This is a Things-style personal task manager. The vault (markdown files, in the
Obsidian [Tasks plugin](https://publish.obsidian.md/tasks/) format) is the source of
truth. There is deliberately **no model API key and no Google/Slack OAuth app in the
app**. Whenever the user asks you (the agent) to capture something, sync their tasks
or plan their day, you do it yourself: parse their text, call the Gmail/Calendar/Slack
tools your session is already connected to, and drive the vault through the
`task-app` CLI. Don't suggest adding API keys back in; that's an intentional design
choice. [README.md](./README.md#design-decisions) explains the reasons behind it and the
other design decisions.

## The CLI is the only way to touch the vault

Never hand-edit the markdown files' task lines yourself (the `🆔`/emoji-field syntax
is easy to get subtly wrong, and the store re-derives project/area from file
location, which a raw edit can silently break). Always shell out to `task-app`.
Run `task-app help` if you need the exact flag syntax. Quick reference:

```bash
task-app add "<title>" [--project P] [--area A] [--due YYYY-MM-DD] \
  [--scheduled YYYY-MM-DD] [--start YYYY-MM-DD] \
  [--priority highest|high|medium|low|lowest] [--recurrence "every week"] \
  [--tag foo] [--tag bar] [--notes "..."] [--someday] \
  [--goal G] [--focus] [--waiting "Person"] [--followup YYYY-MM-DD] [--est 30m]

task-app list [inbox|today|overdue|upcoming|anytime|someday|logbook|all|focus|waiting|recurring|project:<name>|area:<name>|goal:<name>] [--json]
task-app complete <id>
task-app uncomplete <id>          # also removes the untouched next occurrence of a recurring task
task-app skip <id>                # recurring task → next occurrence, nothing logged (holiday week, cancelled)
task-app edit <id> [--title T] [--due D|none] [--scheduled D|none] [--start D|none] [--priority P|none] [--recurrence R|none] [--tag T] \
  [--goal G|none] [--waiting P|none] [--followup D|none] [--est E|none]
task-app move <id> [--project P | --area A | --someday | --inbox]
task-app focus <id> [<id> <id>]   # sets EXACTLY these as today's top 3 (untags the rest); --add/--remove/--clear; no args = show
task-app goals [--json]           # goals + open/focus/done-in-7-days counts
task-app project <name> [--goal G|none] [--area A|none]   # show a project / set its frontmatter
task-app review [--json] [--date D]   # one read of everything a plan/review needs
task-app note show [--date D] [--section S] [--json]
task-app note write --section S [--date D] [--text "..."]  # or pipe the body on stdin
task-app note show --previous --section Shutdown   # latest earlier note with that section
task-app notes [--since D] [--content] [--json]    # changed notes: ## Actions + tasks already captured from each
task-app capture [--dry-run] [--json]   # the sweep of the notes world: adds every ## Actions bullet from an untouched note into the Inbox
task-app sweep    # relocates completed tasks into Logbook.md; safe to run anytime
task-app doctor [--fix] [--json]  # health check: duplicate ids, missing ✅ dates, junk in titles, misfiled Inbox items
```

If a command fails with "is no longer in …" or "appears N times", the vault changed
underneath it or has a duplicate id. Run `task-app doctor` and show the user what it
found before running `--fix`. `add`/`edit` reject titles that contain CLI output
(`[area:Work]`) or a task-app flag (`--project`). That error means a flag was quoted into
the title, so fix the command rather than stripping the text by hand.

`list --json` is what you should use when you need to reason about existing tasks
(dedup checks, building a plan, etc.) — it's structured and cheap on context
compared to reading the raw vault files. Use plain `list` (no `--json`) when just
reporting task state back to the user in chat.

Project/area names must match an existing project/area exactly (case-sensitive) or
you'll create a duplicate — run `task-app list all --json` first and check the
`project`/`area` fields on existing tasks, or look at what's under
`<vault>/Tasks/Projects/` and `<vault>/Tasks/Areas/`, before inventing a new one.

## Goals, focus, waiting-on, estimates

These are the "what matters" layer. All of it is stored as plain tags or frontmatter, so it
survives Obsidian edits:

- **Goals** are the user's ~90-day outcomes: one `## Heading` each in `<tasks>/Goals.md`, with
  optional frontmatter `horizon:`. The user owns the wording, so edit that file only when
  asked. A project links to a goal via its frontmatter (`task-app project CRM --goal CRM`),
  and its tasks inherit it. A task outside a goal-linked project can link directly with
  `--goal` (`#goal/<slug>`). `--goal` must match an existing goal, and the error lists the
  valid ones.
- **Focus** (`#focus`) marks today's top 3, and focus tasks always show in Today.
  `task-app focus a b c` replaces the whole set in one call. Don't exceed 3 without the
  user's say-so (`--force`).
- **Waiting-on** (`--waiting "Morgan"`, stored as `#waiting/morgan`) is for delegated items
  or ones blocked on someone. The follow-up date is the ⏳ scheduled date (`--followup` is an
  alias), so the task shows up in Today on the day to chase it. Treat the legacy
  `#waiting-on` tag as waiting on an unnamed person. When capturing a task where someone
  else owes the user something, use `--waiting` rather than putting the name in the title,
  and suggest a follow-up date.
- **Estimates** (`--est 30m`, `#est/30m`) are used to check a plan against free calendar time.
  If a focus task has no estimate, say you're guessing; don't invent one silently.
- **Recurring tasks** (`--recurrence "every monday"`, stored as `🔁 every monday`) need a date to
  count from, so give them a `--scheduled` (or `--due`) for the first occurrence. `complete` ticks
  that occurrence into the Logbook and adds the next one, always dated after today, so missed weeks
  are skipped rather than recreated as overdue copies. When the user says a week isn't happening
  (holiday, meeting cancelled), use `skip`, not `complete`, so the Logbook stays truthful. Supported
  rules: `every [N] day(s)/week(s)/month(s)/year(s)`, `every weekday`, `every <weekday>`, any of
  them with `when done` to count from the completion date instead.

`review --json` is the main input for planning and reviews. It holds focus, today, overdue,
due-within-7-days, Inbox (with age/`stale`), waiting (`followUpDue` / `noFollowUpDate` /
`later`), per-goal and per-project health (`noActiveTask`, `noNextAction`), `unlinked` and
`stale` open tasks, estimate totals, the last 7 days' completions, and any `doctor` issues.

## The daily note is the master record

Each day's plan lives in the user's Obsidian daily note, `<vault>/YYYY-MM-DD.md` (or the
`dailyNotesDir` set in the config). Only `task-app note write` touches it, and only the
`## <Section>` it's given (`Plan`, `Meetings`, `Shutdown`). The user's own notes in the file are never
modified. Write plans as plain numbered or bulleted lists that reference task ids like
`(abc123)`, **never `- [ ]` checkboxes**, because the Obsidian Tasks plugin would pick those up
as duplicate tasks.

## Natural-language capture

When the user says something like "add: call the dentist tomorrow" or pastes a rough
note, don't just dump it through `quickParse` — you're the smart layer now. Resolve
relative dates yourself (today's date is whatever `date` reports), figure out
title vs. project vs. priority, and call `task-app add` with explicit flags. Only
rely on the CLI's own naive date-guessing fallback (chrono-node) as a safety net for
when a human runs `task-app add` directly from a plain terminal without you.

## Pulling in Gmail / Calendar / Slack

Use your session's own authenticated connectors (MCP servers or equivalent) for these.
There's no sync module in the app to call. If your session has no connector for a
service, tell the user rather than working around it. General pattern:

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

## Routines: morning plan, shutdown, weekly review, meeting capture

The step-by-step routines live in `skill/task-app/routines/`. **Read the matching file and
follow it**:

- `morning-plan.md`: "plan my day", or the 08:30 weekday scheduled task (it includes `meeting-prep.md`)
- `shutdown.md`: "wrap up", or the 16:30 Mon–Thu scheduled task
- `weekly-review.md`: "weekly review", or the Friday 16:00 scheduled task (it includes Friday's shutdown)
- `meeting-capture.md`: "process my notes", on demand only

Rules they all share: **propose, then act.** The user confirms the top 3 before
`task-app focus` runs, and calendar focus blocks are created only after an explicit yes.
Captures from notes are listed first and added on a yes. Unattended scheduled runs write their
proposals to the daily note and chat, and change nothing else.

`task-app capture` is a different, blunter tool than `meeting-capture.md` — it's the
mechanical "sweep" of the notes world: every `## Actions` bullet from a note nothing's
been captured from yet, added to the Inbox verbatim, no judgment applied (see its help
text for the exact rule). Use `meeting-capture.md`'s routine, not this, whenever you're
actually processing notes with the user — it classifies each item (task vs. waiting-on vs.
skip), dedups by meaning, and writes better titles, none of which `capture` does. Reach for
`task-app capture` (or suggest it) only as a periodic safety net for notes nobody's engaged
with at all — e.g. if the user asks "did I miss capturing anything?" — and always run it
with `--dry-run` first to show them what it would add before actually adding it.

`skill/task-app/` is an [Agent Skill](https://agentskills.io) (`SKILL.md` plus `routines/`),
and it's the source for every installed copy. In Claude it's uploaded as an account skill
(`npm run skill:pack`, then Settings → Skills). The copy under
`~/Library/Application Support/Claude/…` is a synced cache, so don't edit it. Other agents
load it from their own skills directory. After changing the skill here, tell the user to
re-upload or re-copy it.

## Developing task-app

`npm test` (node:test against throwaway temp vaults, never the real one) and
`npm run build` (clean rebuild into `dist/`, which the linked `task-app` binary runs).
Rebuild after any source change, or the CLI keeps running the old code.

## Desktop widget

`desktop/` is an Electron menu-bar widget (popover, ⌃⌥Space quick capture, floating focus pill).
Its main process imports `../src/core` directly, so a core change also affects the widget. The
user runs the packaged copy in `~/Applications/task-app.app`, so after changing `src/core` or
`desktop/`, run `npm run widget:install` (or tell the user to) or they'll keep running the old build. It uses a read-only scan (`new TaskStore(config, { persistIds: false })`)
so its file watcher never writes. It never sets focus, and has no timer, AI calls or calendar writes
(the user's choices). Keep it that way unless they ask.

## Vault layout

```
<vault>/Tasks/
  Inbox.md              # unfiled captures
  Someday.md             # backlog, no date
  Logbook.md              # completed tasks, archived here by `task-app sweep`
  Goals.md                # ## one heading per goal; frontmatter `horizon:`
  Areas/<Name>.md         # area-level tasks with no specific project
  Projects/<Name>.md      # optional frontmatter: `area: <Area name>`, `goal: <Goal name>`
<vault>/YYYY-MM-DD.md     # daily notes: task-app owns only its ## Plan / ## Meetings / ## Shutdown sections
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
