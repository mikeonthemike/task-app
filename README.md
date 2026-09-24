# task-app

A personal task manager in the spirit of [Things](https://culturedcode.com/things/), run from
the terminal, backed by your Obsidian vault — with Claude Code as the "smart" layer instead of
any built-in API key.

- **Storage**: tasks are plain markdown checkboxes in your vault, using the
  [Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) syntax (`📅` due, `⏳` scheduled,
  `⏫`/`🔼`/etc priority, `🔁` recurrence). No custom Obsidian plugin required — install the Tasks
  community plugin if you also want to query/filter tasks from inside notes.
- **Views**: Inbox, Today, Focus, Waiting, Upcoming, Anytime, Someday, Logbook, plus one list
  per Project (`Tasks/Projects/*.md`) and Area (`Tasks/Areas/*.md`).
- **What matters**: 90-day goals in `Tasks/Goals.md` that projects and tasks link to, a daily top 3
  (`#focus`), waiting-on items with follow-up dates (`#waiting/<person>`), and effort estimates
  (`#est/30m`). All of it is stored as plain tags or frontmatter.
- **Daily note as the record**: `task-app note write` keeps `## Plan` / `## Shutdown` sections in
  your Obsidian daily note, and `task-app review --json` gives a planner everything it needs in
  one read.
- **TUI**: browse and complete tasks, quick-add with a basic natural-date fallback (no API key
  needed at all for this).
- **The smart stuff (capture, Gmail/Calendar/Slack sync, daily planning) is driven by talking to
  Claude Code**, not by the app calling out to Anthropic or Google/Slack APIs itself. See
  [CLAUDE.md](./CLAUDE.md) for exactly how that works.

## Why no API keys?

The original design had the app hold its own Anthropic key and Google OAuth client. If you
don't have (or don't want to set up) either of those, but you're already using Claude Code —
which has its own model and its own authenticated Gmail/Calendar/Slack connectors — there's no
reason to duplicate that. Instead, `task-app` exposes scriptable commands
(`add` / `list` / `complete` / `edit` / `move`), and a Claude Code session (this one, a fresh one
pointed at this folder, or a scheduled one) calls them directly: it parses your rough capture
text itself, pulls from Gmail/Calendar/Slack with its own connectors, and writes your daily plan
straight into chat. `CLAUDE.md` documents the exact conventions so any session picks this up
without re-explaining it.

If you'd rather have the app work standalone with its own keys, that's a reasonable direction to
add back later — it's just not what's built right now.

## Setup

```bash
npm install
npm run build
npm link          # makes the `task-app` command available globally
npm test          # runs against throwaway temp vaults, never your real one
task-app init
```

`init` just asks for your vault path and which subfolder to use for tasks (default `Tasks`).

Run `task-app` with no arguments to launch the TUI, or `task-app help` for the full command
reference.

### TUI keybindings

| Key | Action |
| --- | --- |
| `h` / `l` or ←/→ | switch list (Inbox, Today, Upcoming, ...) |
| `j` / `k` or ↑/↓ | move selection |
| `space` / `enter` | complete the selected task |
| `a` | quick-add a task (plain text; a natural-language date like "tomorrow" is picked up locally) |
| `e` | edit the selected task — opens a pre-filled `--title ... --due ... --project ...` line (same flags as the CLI's `edit`/`move`); delete a flag to clear that field, `esc` to cancel |
| `x` | sweep completed tasks into `Logbook.md` |
| `c` | capture `## Actions` bullets from untouched notes into the Inbox (see `task-app capture`) |
| `q` / `esc` | quit |

Every task line also shows its id in brackets, e.g. `[cc7xg7sv]` — that's what `task-app edit/move/complete` take on the command line.

### Menu-bar widget (macOS)

`desktop/` is a small Electron app that sits in the menu bar:

- **Popover** (click the ☑ icon): today's top 3, the `## Plan` from your daily note, waiting-on
  follow-ups that are due, the rest of Today (overdue first), and what you've done today. Tick a
  circle to complete a task; click a title to open its file in Obsidian.
- **Quick capture** (⌃⌥Space anywhere): one line into the Inbox, with the same basic date
  pickup as the TUI ("call the dentist tomorrow").
- **Focus pill**: an always-on-top strip showing one focus task at a time. Toggle it from the
  popover or the icon's right-click menu, and drag it wherever you like.

The widget only *shows* your top 3; setting them is still Claude's proposal plus your yes. It
reads and writes the vault through the same `src/core` code as the CLI and rescans when files
change. Those rescans never write, so a task you're mid-typing in Obsidian doesn't get an id
appended under your cursor. Ids are only saved when you act on a task in the widget.

```bash
cd desktop && npm install && cd ..
npm run widget     # builds and launches it
```

It isn't packaged into a `.app` yet, so "Open at login" is hidden until it is.

### Using it with Claude Code

Open a Claude Code session in this folder (or any folder — the CLI works from anywhere once
`task-app init` has run) and just talk to it normally:

- *"Add a task: call the dentist tomorrow, and renew my passport by end of October"*
- *"Check my starred emails and calendar and pull anything actionable into my inbox"*
- *"What should I focus on today?"*
- *"Move the passport task into a new Travel project"*

Claude reads [CLAUDE.md](./CLAUDE.md) for the exact `task-app` command syntax and the
conventions for deduping Gmail/Slack imports, so it should do the right thing without needing
each command spelled out. For a recurring morning briefing, set up a
[scheduled Claude Code task](https://docs.claude.com) that runs the "daily planning" steps from
`CLAUDE.md` each weekday.

## Daily routines

The day runs on four routines that Claude follows, defined in
[`skill/task-app/routines/`](./skill/task-app/routines):

| Routine | When | Writes to the daily note |
| --- | --- | --- |
| Morning plan | weekdays 08:30 (scheduled) | `## Plan`: proposed top 3, focus blocks, follow-ups due |
| Evening shutdown | Mon–Thu 16:30 (scheduled) | `## Shutdown`: done, carry-over, actions to capture, draft top 3 |
| Weekly review | Fridays 16:00 (scheduled) | `## Weekly Review`: inbox, waiting-on, goal health, next week |
| Meeting-notes capture | on demand ("process my notes") | adds tasks after you confirm |

The scheduled runs only *propose*. You reply in the run's session to confirm the top 3
(`task-app focus`), book focus blocks in Calendar, or capture actions.

Meeting-notes capture does real judgment — classifying each action as a task vs.
waiting-on vs. skip, writing a clean title, deciding where it's filed. `task-app capture`
(or `c` in the TUI) is a blunter, mechanical fallback: it adds every `## Actions` bullet
from a note nothing's been captured from yet, verbatim, into the Inbox — a periodic
safety net for notes nobody's engaged with at all, not a replacement for the routine.

`skill/task-app/` is also the source for the `task-app` Claude skill, which makes all of this
available from any Claude session on this Mac. After changing it, run `npm run skill:pack` and
upload `task-app-skill.zip` under Settings → Capabilities → Skills.

## Vault layout

```
<vault>/Tasks/
  Inbox.md              # unfiled captures (quick-add, or things Claude pulls in)
  Someday.md             # backlog, no date
  Logbook.md              # completed tasks, archived here by `task-app sweep`
  Areas/
    Personal.md
    Work.md
  Projects/
    Website Redesign.md  # optional frontmatter: `area: Work`
```

Completing a task just flips its checkbox in place — it doesn't move anywhere, and `task-app list logbook` already shows every completed task regardless of which file it physically lives in. Over time that leaves old `[x]` lines cluttering your Project/Area files, so run `task-app sweep` (or press `x` in the TUI) whenever you want to tidy up: it relocates every completed task into `Logbook.md`, tagging it with its original project/area (e.g. `#area/work`) so that history isn't lost. Safe to run anytime, and a no-op if there's nothing to sweep.

A task line looks like:

```
- [ ] Draft homepage copy 📅 2026-09-30 🔼 🆔 abc126
```

The `🆔` field is task-app's own stable id (also used by the Tasks plugin for dependency
linking) — don't remove it, or the task will be treated as new on the next scan.

You don't have to add it yourself: if you type a task straight into Obsidian without
one, task-app assigns it an id the first time it scans the vault (any `task-app`
command, or opening the TUI) and writes it back into the file, so it stays stable
from then on.

## Config file

Lives at `~/.config/task-app/config.json`:

```json
{
  "vaultPath": "/Users/you/ObsidianVault",
  "tasksDir": "Tasks"
}
```

## Command reference

```
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
  --goal <goal>                     Link to a goal in Goals.md (#goal/…)
  --focus                           Make it one of today's top 3
  --waiting <person>                Waiting on someone (#waiting/…)
  --followup <YYYY-MM-DD>           When to chase it (alias for --scheduled)
  --est <30m|2h|1h30m>              Effort estimate (#est/…)

task-app list [section] [--json]  Sections: inbox, today, overdue, upcoming,
                                   anytime, someday, logbook, all, focus,
                                   waiting, project:<name>, area:<name>,
                                   goal:<name>. Default: today.

task-app complete <id>            Mark a task done.
task-app uncomplete <id>          Undo that.

task-app edit <id> [flags]        Update fields in place (doesn't move file).
  --title <text> --due <date|none> --scheduled <date|none> --start <date|none>
  --priority <level|none> --recurrence <text|none> --tag <tag> (repeatable, adds)
  --goal <goal|none> --waiting <person|none> --followup <date|none> --est <dur|none>

task-app focus [<id>...] [--force] Set exactly these as today's top 3 (#focus).
  --add <id> | --remove <id> | --clear   No args: show current focus.

task-app goals [--json]           Goals from Goals.md with open/focus/done counts.
task-app project <name> [--goal <goal>|none] [--area <area>|none]
                                   Show a project, or set its frontmatter.

task-app review [--json] [--date D]  Everything a plan or review needs in one
                                   read: focus, overdue, follow-ups, stale
                                   items, goal and project health, estimates.

task-app note show [--date D] [--section S] [--json]
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
                                   ## Actions bullet from an untouched note into
                                   the Inbox, tagged "From: <name>.md". Only
                                   touches a note with nothing captured from it
                                   yet. --dry-run previews without writing.

task-app doctor [--fix] [--json]  Check task files for duplicate ids, missing
                                   done dates, junk in titles and misfiled Inbox
                                   items. Read-only unless --fix is given.

task-app help                     Show this message.
```
