# task-app

A personal task manager in the spirit of [Things](https://culturedcode.com/things/), stored as
plain markdown in your Obsidian vault, with an AI agent as its "smart" layer.

task-app itself is deliberately simple: a CLI, a terminal UI and a macOS menu-bar widget, all
built on one small core that reads and writes the vault. It has no model, no API keys and no
network access. Parsing a rough capture, pulling actions out of email or meeting notes and
planning your day are done by an agent you already use: it calls `task-app` in a shell and uses
its own Gmail, Calendar and Slack connectors. [Claude](https://claude.com/claude-code) is the
recommended agent, and any agent that reads [`AGENTS.md`](./AGENTS.md) and can run shell commands
will work.

## Design decisions

These are the choices that shape everything else. They're deliberate, so please don't "fix" them
without a conversation.

**The vault is the source of truth.** Tasks are ordinary checkbox lines in the
[Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) format (`📅` due, `⏳` scheduled,
`⏫`/`🔼` priority, `🔁` recurrence, `🆔` id). There's no database, sync service or custom
Obsidian plugin. Your tasks stay readable and editable in Obsidian, grep, git or any other
editor, and they still work if you stop using task-app.

**Structure comes from where a task lives.** A task's project or area is the file it's in
(`Tasks/Projects/<Name>.md`, `Tasks/Areas/<Name>.md`). Everything else is plain tags or
frontmatter that Obsidian won't mangle: goals (`#goal/…`), today's top 3 (`#focus`),
waiting-on (`#waiting/<person>`) and estimates (`#est/30m`). Moving a task means moving its
line, so that's the CLI's job.

**Only the CLI writes task lines.** Emoji-field syntax is easy to get subtly wrong, and a
hand edit in the wrong file silently changes a task's project. Agents are told never to edit
task lines by hand. `add`/`edit` reject titles that contain CLI flags or CLI output, and
`task-app doctor` finds duplicate ids, missing done dates and misfiled items.

**Stable ids, assigned lazily.** Each task carries a short `🆔` id, which the Tasks plugin also
uses for dependencies. If you type a task straight into Obsidian, task-app gives it an id the
next time it scans the vault and writes it back, so agents and the CLI always have a stable
handle.

**No AI in the app, and no API keys.** An agent session already has a capable model and
authenticated connectors, so task-app doesn't duplicate them. It exposes scriptable commands
with `--json` output, and the agent brings the judgment. The CLI's own natural-date parsing
(chrono-node, plus repeat phrases like "every monday") is only a fallback for people typing into a
plain terminal or the widget. It runs only when `add` gets no flags, and never picks a past date.

**Propose, then act.** The agent suggests and you decide. Today's top 3, calendar focus blocks,
triage moves and captures from notes are all proposals until you say yes. Scheduled runs that
happen while you're away only write proposals to your daily note. They never set focus, book
time, send messages or reorganise tasks.

**Goals feed a daily top 3.** `Tasks/Goals.md` holds a few ~90-day outcomes, one `## heading`
each. Projects link to a goal through frontmatter, and their tasks inherit it. Each day the
agent proposes three `#focus` tasks that move a goal forward, and `task-app review` flags goals
and projects with nothing active.

**The daily note is the master record.** Each day's plan, meetings and shutdown are sections
(`## Plan`, `## Meetings`, `## Shutdown`) in your Obsidian daily note. task-app only ever
replaces its own sections and never touches your writing around them. Plans reference task
ids and never use `- [ ]` checkboxes, which the Tasks plugin would pick up as duplicate tasks.

**Completed tasks stay put until you sweep.** Completing a task only flips its checkbox, and
the Logbook view finds done tasks wherever they are. `task-app sweep` moves them into
`Logbook.md`, tagging each with the project or area it came from.

**The widget is a window, not a second brain.** The menu-bar widget shows your top 3 and
Today, and lets you tick tasks off or capture one line into the Inbox. It never sets focus,
has no timer or time tracking, and makes no AI or network calls. Its file watcher never writes,
so a task you're halfway through typing in Obsidian doesn't get an id appended under your
cursor.

## How it fits together

```
src/core/     the vault model: parse/serialise task lines, the store, goals, review,
              daily notes, notes scanning, doctor. Everything else is built on this.
src/cli.tsx   the task-app command (scriptable, --json everywhere)
src/tui/      an Ink terminal UI (run task-app with no arguments)
desktop/      an Electron menu-bar widget; imports src/core directly
skill/        the agent skill: SKILL.md plus step-by-step routines
AGENTS.md     instructions for any agent driving or developing task-app
```

The agent side has two layers. [`AGENTS.md`](./AGENTS.md) holds the conventions an agent needs
when it's working in this folder. [`skill/task-app/`](./skill/task-app) is an
[Agent Skill](https://agentskills.io) (`SKILL.md` plus `routines/`) that makes the same
behaviour available from any session, in any folder. See [The agent skill](#the-agent-skill).

## Setup

Requires Node 20+ and an Obsidian vault (the Tasks plugin is optional, but useful for querying
tasks from inside notes).

```bash
npm install
npm run build
npm link          # puts `task-app` on your PATH
task-app init     # asks for your vault path and tasks folder (default "Tasks")
```

The config lives in `~/.config/task-app/config.json`:

```json
{
  "vaultPath": "/Users/you/ObsidianVault",
  "tasksDir": "Tasks",
  "dailyNotesDir": ""
}
```

`dailyNotesDir` is where your `YYYY-MM-DD.md` daily notes live, relative to the vault root
(empty means the vault root).

Quick capture reads numeric dates day first, so "by 9/10" means 9 October. If you write dates
month first, add `"dateOrder": "mdy"`.

## Using it with an agent

Open an agent session (Claude Code, or any agent that reads `AGENTS.md`) in this folder and talk
normally:

- *"Add: call the dentist tomorrow, and renew my passport by end of October"*
- *"I'm waiting on Sam for the contract, chase them on Thursday"*
- *"Check my starred emails and calendar and pull anything actionable into my inbox"*
- *"Plan my day"* / *"wrap up"* / *"weekly review"* / *"process my notes"*

In this folder the agent follows `AGENTS.md`. To get the same behaviour from a session in any
other folder, install the skill.

## The agent skill

[`skill/task-app/`](./skill/task-app) is an [Agent Skill](https://agentskills.io): a folder with
a `SKILL.md` that agents load when a request matches its description, plus the routines it
refers to. `AGENTS.md` covers working in this repo. The skill is what makes *"add: renew my
passport by end of October"* work from any session: a chat in the Claude app, a Claude Code
session in another project, or a scheduled run.

```
skill/task-app/
  SKILL.md                 # when to trigger, ground rules, command reference, the data model,
                           # time and working hours, capture and connector conventions
  routines/
    morning-plan.md        # "plan my day": proposed top 3, focus blocks, follow-ups (## Plan)
    meeting-prep.md        # compact context for today's meetings (## Meetings)
    shutdown.md            # "wrap up": done, carry-over, to capture, draft top 3 (## Shutdown)
    weekly-review.md       # "weekly review": the checklist, plus Friday's shutdown (## Weekly Review)
    meeting-capture.md     # "process my notes": notes → tasks and waiting-ons, after a yes
    triage-inbox.md        # "triage my inbox": a home for every Inbox item, applied after a yes
```

The skill uses the same rules as `AGENTS.md`: never hand-edit task lines, and propose before
acting. It needs a shell on the machine that holds the vault, with `task-app` on the PATH, so
it won't work in a browser-only or sandboxed session. Gmail, Calendar and Slack steps use
whatever connectors the session has. If one is missing, the routine skips that step and says
so.

**Personal settings.** Nothing personal is baked in. The timezone is the machine's own
(`date +%Z`), and the working day defaults to 08:30–17:30, Monday to Friday. To change either,
tell the agent: put it in your agent's memory or user-level instructions (for example
`~/.claude/CLAUDE.md`), e.g. *"I work 09:00–17:00 and I'm in Europe/London"*. The skill
prefers what you've said over its defaults.

**Installing it**

- **Claude app (chat, Cowork, scheduled tasks):** run `npm run skill:pack` and upload
  `task-app-skill.zip` under Settings → Skills. The app keeps its own copy, so re-upload after
  changing anything in `skill/`.
- **Claude Code:** link it into your personal skills folder so it follows the repo:
  `ln -s "$PWD/skill/task-app" ~/.claude/skills/task-app`
- **Other agents:** link or copy `skill/task-app` into your agent's skills directory. If your
  agent doesn't support skills, point it at `SKILL.md` from its instructions file.

### Daily routines

The routines set how the day runs. You can run each one on request or put it on a schedule;
the times below are suggestions, and the routines work whenever they run.

| Routine | Suggested schedule | Writes to the daily note |
| --- | --- | --- |
| Morning plan (includes meeting prep) | weekdays 08:30 | `## Plan` (proposed top 3, focus blocks, follow-ups due) and `## Meetings` |
| Shutdown | Mon–Thu 16:30 | `## Shutdown`: done, carry-over, actions to capture, draft top 3 for tomorrow |
| Weekly review | Fri 16:00 (includes Friday's shutdown) | `## Weekly Review`: Inbox, waiting-on, goal health, next week |
| Meeting-notes capture | on demand ("process my notes") | nothing: proposes tasks, adds them when you say yes |
| Inbox triage | on demand ("triage my inbox"); part of the weekly review | nothing: proposes a home for each Inbox item, files them when you say yes |

Meeting-notes capture uses judgment: it classifies each action as a task, a waiting-on item or
a skip, dedups by meaning, and writes clean titles. `task-app capture` is the blunt fallback. It
adds every `## Actions` bullet from notes nothing has been captured from yet into the Inbox,
word for word. It's a safety net for notes nobody has looked at, not a replacement for the
routine (use `--dry-run` first).

## Without an agent

Everything works without an agent too, just without the judgment.

**TUI.** Run `task-app` with no arguments.

| Key | Action |
| --- | --- |
| `h` / `l` or ←/→ | switch list (Inbox, Today, Upcoming, …) |
| `j` / `k` or ↑/↓ | move the selection |
| `space` / `enter` | complete the selected task |
| `a` | quick-add (plain text; a date like "tomorrow" or a repeat like "every monday" is picked up) |
| `e` | edit: a pre-filled `--title … --due … --project …` line; delete a flag to clear that field, or add `--notes "…"` to add a note |
| `x` | sweep completed tasks into `Logbook.md` |
| `c` | capture `## Actions` bullets from untouched notes (see `task-app capture`) |
| `q` / `esc` | quit |

Each task shows its id in brackets, e.g. `[cc7xg7sv]`. That's the id `complete`, `edit` and
`move` take.

**Menu-bar widget (macOS).** `desktop/` gives you:

- **Popover** (click the ☑ icon): today's top 3, the `## Plan` from your daily note, follow-ups
  due, the rest of Today and what you've done today. Tick a task to complete it, or click its
  title to open it in Obsidian. The "Today ▾" title switches lists (the TUI's lists plus
  **All open**), ←/→ steps through them and Esc returns to Today.
- **Quick capture** (⌃⌥Space from anywhere): one line into the Inbox. Dates ("fri") and repeats
  ("every monday", "every 2 weeks", "every month from 1 Nov") and "end of …" phrases ("by end of
  October", "EOW") are picked up, and the hint shows
  how the line was read before you press Enter. Recurring tasks show 🔁 in every list.
- **Focus pill**: an always-on-top strip showing one focus task at a time. Toggle it from the
  popover or the icon's right-click menu.

```bash
npm --prefix desktop install
npm run widget:install   # builds task-app.app into ~/Applications and launches it
```

Turn on **Open at login** from the icon's right-click menu. The build is ad-hoc signed, so macOS
may ask for Documents access again after a reinstall. The installed copy doesn't update itself,
so re-run `widget:install` after pulling changes. `npm run widget` runs it from source.

## Vault layout

```
<vault>/
  Tasks/
    Inbox.md               # unfiled captures
    Someday.md             # backlog, no date
    Logbook.md             # completed tasks, moved here by `task-app sweep`
    Goals.md               # one ## heading per goal; optional frontmatter `horizon:`
    Areas/Work.md          # area-level tasks with no specific project
    Projects/Launch.md     # optional frontmatter: `area: Work`, `goal: Launch`
  2026-09-28.md            # daily note; task-app owns only its ## Plan / ## Meetings / ## Shutdown
```

A task line:

```
- [ ] Draft homepage copy 📅 2026-09-30 🔼 #est/45m 🆔 abc126
```

## Command reference

`task-app help` prints the full reference. In summary:

| Command | What it does |
| --- | --- |
| `add <title> [flags]` | Add a task. Flags: `--project`, `--area`, `--due`, `--scheduled`, `--start`, `--priority`, `--recurrence`, `--tag` (repeatable), `--notes`, `--someday`, `--goal`, `--focus`, `--waiting <person>`, `--followup`, `--est` |
| `list [view] [--json]` | `inbox`, `today` (default), `overdue`, `upcoming`, `anytime`, `someday`, `logbook`, `all`, `focus`, `waiting`, `recurring`, `project:<name>`, `area:<name>`, `goal:<name>` |
| `complete` / `uncomplete <id>` | Tick or untick a task. A recurring task spawns its next occurrence, always after today (unticking removes it again if untouched) |
| `skip <id>` | Move a recurring task to its next occurrence without completing it |
| `edit <id> [flags]` | Change fields in place; pass `none` to clear one. `--notes` adds a note line, skipping one the task already has |
| `move <id>` | `--project`, `--area`, `--someday` or `--inbox` |
| `focus [<id>…]` | Set exactly these as today's top 3; `--add`, `--remove`, `--clear`; no args shows them |
| `goals [--json]` | Goals with open, focus and recently-done counts |
| `project <name>` | Show a project, or set its `--goal` / `--area` frontmatter |
| `review [--json]` | Everything a plan or review needs in one read |
| `note show` / `note write` | Read or replace a `## Section` of a daily note |
| `notes [--since D]` | Notes changed since a date, with their `## Actions` and what's been captured |
| `capture [--dry-run]` | Sweep `## Actions` bullets from untouched notes into the Inbox |
| `sweep` | Move completed tasks into `Logbook.md` |
| `doctor [--fix]` | Vault health check (read-only unless `--fix`) |

## Development

```bash
npm test          # node:test against throwaway temp vaults, never your real one
npm run build     # clean rebuild into dist/, which the linked binary runs
```

Rebuild after any source change, or `task-app` keeps running the old code. The widget imports
`src/core`, so changes there also need `npm run widget:install`.

## License

[MIT](./LICENSE)
