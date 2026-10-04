---
name: task-app
description: Manages the user's personal productivity system, a Things-style task manager stored as markdown in their Obsidian vault, via the local `task-app` CLI (never by hand-editing vault files). Trigger whenever the user wants to add/capture/jot down a task, even casually ("remind me to...", "I need to...", "add to my list", "waiting on X for Y"); asks what's on their plate, agenda, focus or to-do list, today/this week/overdue/upcoming; wants a morning plan, top 3, evening shutdown, or weekly review; asks about their goals or what they're waiting on; wants actions pulled from their meeting notes ("process my notes"), or asks you to check Gmail/Calendar/Slack for anything actionable; wants to mark something done, reopen it, or move it between projects/areas; wants focus time blocked in their calendar; or wants to clean up/archive finished tasks. Also trigger on "my Obsidian tasks"/"my daily note" in a to-do or planning context. Needs the `task-app` CLI and a shell tool — check with `task-app help` first.
compatibility: Works with any agent that can run shell commands on the machine that holds the vault, with the `task-app` CLI on PATH (installed via `npm link` from a clone of the task-app repo). Not usable in a browser-only or sandboxed session with no access to the host shell. Gmail/Calendar/Slack steps use whatever connectors the session has, and are skipped (and said so) when one is missing.
---

# task-app

The user's tasks live as plain markdown in their Obsidian vault, in the
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) format. A local CLI called
`task-app` is the only supported way to read or change them. It has no AI or API keys of its
own, so **you are the smart layer**: you parse intent, plan the day, and drive `task-app`
with explicit flags.

## Ground rules

- **Never hand-edit task lines** in the vault. The emoji-field syntax is easy to get subtly
  wrong, and project/area come from which file a task lives in. If `task-app` can't do
  something, say so rather than improvising. You may *read* the user's notes, and you may edit
  `Tasks/Goals.md` when the user asks you to change their goals.
- **Propose, then act.** Top-3 focus, calendar focus blocks, triage moves and captures from notes
  are proposals until the user says yes. Scheduled or unattended runs write their proposals into
  the daily note and chat; they never set focus, create calendar events, send messages, or
  reorganise tasks.
- Before first use in a session, run `task-app help`. Shells used by tools often don't source
  `~/.zshrc`, so if `task-app` is "not found", retry with `"$(npm prefix -g)/bin/task-app"`
  before concluding it's missing. Don't reinstall or reconfigure it yourself. (The config lives
  at `~/.config/task-app/config.json`; setup is `task-app init`.)
- If a command fails with "is no longer in …" or "appears N times", run `task-app doctor`, show
  the user what it found, and run `--fix` only with their OK.

## Command reference

```bash
task-app add "<title>" [--project P] [--area A] [--due D] [--scheduled D] [--start D] \
  [--priority highest|high|medium|low|lowest] [--recurrence "every week"] [--tag t] [--notes "..."] [--someday] \
  [--goal G] [--focus] [--waiting "Person"] [--followup D] [--est 30m]
task-app list [inbox|today|overdue|upcoming|anytime|someday|logbook|all|focus|waiting|recurring|project:<n>|area:<n>|goal:<n>] [--json]
task-app complete <id>            # recurring tasks get their next occurrence automatically (always after today)
task-app uncomplete <id>          # also removes that untouched next occurrence
task-app skip <id>                # recurring task → next occurrence without logging it
task-app edit <id> [--title T] [--due D|none] [--scheduled D|none] [--start D|none] [--priority P|none] \
  [--recurrence R|none] [--tag T] [--goal G|none] [--waiting P|none] [--followup D|none] [--est E|none]
task-app move <id> [--project P | --area A | --someday | --inbox]
task-app focus <id> [<id> <id>]   # EXACTLY these become today's top 3; --add/--remove/--clear; no args = show
task-app goals [--json]
task-app project <name> [--goal G|none] [--area A|none]
task-app review [--json] [--date D]   # everything a plan/review needs, in one read
task-app notes [--since D] [--content] [--json]   # notes changed since D: ## Actions + already-captured tasks
task-app capture [--dry-run] [--json]   # sweep of the notes world: every ## Actions bullet from an untouched note → Inbox, verbatim
task-app note show [--date D] [--section S] [--previous] [--json]
task-app note write --section S [--date D] [--text "..."]   # or pipe the body on stdin (preferred)
task-app sweep                    # archive completed tasks into Logbook.md; safe anytime
task-app doctor [--fix] [--json]  # vault health check
```

Use `--json` whenever you're reasoning over tasks, and plain output only when relaying state
to the user. Dates are `YYYY-MM-DD`; resolve relative dates yourself (`date +%F`, and see
"Time and working hours" below). Project and area names must match existing ones exactly, so check
`task-app list all --json` or `task-app review --json` → `projects` before using a new name.

## Time and working hours

- **Timezone**: the machine's local timezone (`date +%Z`), unless the user has told you otherwise.
  Use it for "today", calendar ranges and every time you write.
- **Working day**: 08:30–17:30, Monday–Friday, unless the user's own instructions (their
  memory, `AGENTS.md`/`CLAUDE.md`, or what they've said in chat) give different hours. Free
  blocks and capacity checks only count time inside the working day.
- **Routine times** (08:30 plan, 16:30 shutdown, Friday 16:00 review) are suggested schedules.
  Whatever runs them decides when they fire; the routines work at any time of day.

## The model

- **Goals** are the ~90-day outcomes, one `## Heading` each in `Tasks/Goals.md` (`horizon:` in
  frontmatter). Projects link via frontmatter `goal:` (`task-app project X --goal G`), and their
  tasks inherit it. Other tasks can link with `--goal`. A goal with no open task is a gap to flag,
  not something to fill by inventing work.
- **Focus** (`#focus`) is today's top 3. It always shows in Today, and `task-app focus a b c`
  replaces the set.
- **Waiting-on** (`--waiting "Name"`, stored as `#waiting/name`) covers anything someone else owes
  the user. Its ⏳ scheduled date is the follow-up (`--followup`), so it resurfaces in Today on the
  day to chase it. When capturing "X will send me Y", use this rather than a plain task, and
  propose a follow-up date.
- **Estimates** (`--est 45m`) let a plan be checked against free calendar time.
- **Recurring tasks** (`--recurrence "every monday"` plus a `--scheduled` first date) spawn their
  next occurrence on `complete`, always after today, so missed weeks don't pile up as overdue.
  When a week isn't happening, `skip` it rather than completing it. Rules: `every [N]
  day/week/month/year(s)`, `every weekday`, `every <weekday>`, optionally `… when done`.
- **The daily note** (`<vault>/YYYY-MM-DD.md`) is the master record of the day. task-app owns only
  its `## Plan`, `## Meetings`, `## Shutdown` and `## Weekly Review` sections, written with `note write`. Write
  them as plain lists that reference task ids like `(abc123)`, **never `- [ ]` checkboxes**
  (Obsidian Tasks would treat those as duplicate tasks).

## Routines

Each routine has its own file next to this one. Read the relevant file and follow it:

| When | Routine | File |
|---|---|---|
| Morning, or "plan my day" / "what should I focus on" | Morning plan | `routines/morning-plan.md` |
| End of day, or "shut down" / "wrap up the day" | Evening shutdown | `routines/shutdown.md` |
| Friday afternoon, or "weekly review" | Weekly review | `routines/weekly-review.md` |
| "Process my notes", "capture actions from…" | Meeting-notes capture | `routines/meeting-capture.md` |
| Part of the morning plan, or "add meeting prep to my note" | Meeting context (`## Meetings`) | `routines/meeting-prep.md` |

A full brief on one meeting that isn't going into the note ("prep me for my 2pm") belongs to a
standalone meeting-prep skill if the user has one. Otherwise, brief them in chat using the same
sourcing rules as `routines/meeting-prep.md`.

`task-app capture` is not the meeting-capture routine — it's a blunter, mechanical fallback that
adds every `## Actions` bullet verbatim, no classification or dedup-by-meaning. Use
`meeting-capture.md`'s routine for "process my notes"; reach for `capture --dry-run` only as an
occasional safety net (e.g. "did I miss capturing anything?") to show the user what's sitting
untouched, and only actually add it with their OK.

For a quick "what's on my plate?", skip the full routine: `task-app review` (plain) plus
today's calendar, answered in a few lines.

## Natural-language capture

For "add: call the dentist tomorrow" or a rough note: work out the title (short, verb-first),
dates, project/area, goal, waiting-on and estimate yourself, and call `task-app add` with
explicit flags. `add`/`edit` reject titles containing `[area:…]` or a task-app `--flag`; that
means a flag got quoted into the title, so fix the command.

## Pulling in Gmail / Calendar / Slack

Use your own connectors; task-app has no sync module. Fetch the items (starred or labelled mail,
Slack messages with the agreed reaction), check `task-app list all --json` for a dedup tag
(`#gmail/<messageId>`, `#slack/<ts>`), and add new ones with a title you write and
`--tag gmail/<id>` (or `slack/<ts>`). They land in the Inbox unless one clearly belongs to an
existing project. This is capture-only: don't triage or reorganise existing tasks. If a connector
isn't available in this session, say so rather than skipping it silently.

## Calendar focus blocks

Only when the user says yes to specific proposed blocks: one event each, titled
`Focus: <task title>`, with the task id in the description. First check that the slot has no
`Focus:` event already.

## Vault layout

```
<tasks>/                  # usually Tasks/ or tasks/ (see the config)
  Inbox.md  Someday.md  Logbook.md  Goals.md
  Areas/<Name>.md
  Projects/<Name>.md      # frontmatter: area:, goal:
<vault>/YYYY-MM-DD.md     # daily notes
<vault>/**/*.md           # the user's meeting notes (template has ## Notes / ## Actions)
```
