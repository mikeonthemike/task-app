# task-app

A personal task manager in the spirit of [Things](https://culturedcode.com/things/), run from
the terminal, backed by your Obsidian vault — with Claude Code as the "smart" layer instead of
any built-in API key.

- **Storage**: tasks are plain markdown checkboxes in your vault, using the
  [Obsidian Tasks plugin](https://publish.obsidian.md/tasks/) syntax (`📅` due, `⏳` scheduled,
  `⏫`/`🔼`/etc priority, `🔁` recurrence). No custom Obsidian plugin required — install the Tasks
  community plugin if you also want to query/filter tasks from inside notes.
- **Views**: Inbox, Today, Upcoming, Anytime, Someday, Logbook, plus one list per Project
  (`Tasks/Projects/*.md`) and Area (`Tasks/Areas/*.md`).
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
| `q` / `esc` | quit |

Every task line also shows its id in brackets, e.g. `[cc7xg7sv]` — that's what `task-app edit/move/complete` take on the command line.

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

task-app sweep                    Relocate completed tasks into Logbook.md.

task-app help                     Show this message.
```
