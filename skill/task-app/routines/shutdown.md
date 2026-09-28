# Routine: evening shutdown (suggested Mon–Thu 16:30; Friday's is folded into the weekly review)

Goal: close the day in the daily note's `## Shutdown` section: what got done, what's
carrying over, what needs capturing, and a **draft** top 3 for tomorrow. Report and propose
only: no edits to tasks during an unattended run.

Timezone and working day: see the skill's "Time and working hours". Today = `date +%F`.

## 1. Gather (read-only)

```bash
task-app review --json          # doneToday, focus (still open = carry-over), follow-ups, dueSoon
task-app note show --json       # today's Plan (what was intended) and any existing Shutdown
task-app notes --json           # notes changed today: ## Actions + already-captured tasks
```

Calendar: tomorrow's events (local time), to judge tomorrow's capacity and spot
anything needing prep.

## 2. Work out

- **Done today**: `doneToday`. Mark which of them were in today's Plan top 3.
- **Carry-over**: focus tasks still open. One line each on why, if it's obvious (e.g. the
  calendar ate the block); don't guess otherwise.
- **To capture**: from `notes`, action lines in today's notes (and the daily note) that no
  task in `captured` covers. Compare meaning, not exact wording. List them as candidates; **don't
  add them**. The user asked for capture on demand only, so they say "capture those" to add them.
- **Draft top 3 for tomorrow**: carry-overs first if still right, then due-soon, then goal
  work. Check against tomorrow's free time.
- **Prep for tomorrow**: meetings tomorrow that need something read or decided today.
- **Inbox**: only if any item is `stale` (3+ days). Give a count, not a list; the offer
  below covers it.

## 3. Write

Pipe into `task-app note write --section Shutdown`:

```
**Done** (2 of 3 planned)
- ✓ Agree WOW with Sam (k3Jd9sQa)
- ✓ … · also: 2 others

**Carrying over**
- Draft status digest (ab12cd34): afternoon went to the Acme escalation

**To capture?** (from today's notes, not yet tasks)
- Intro with Alex Chen: "share CRM readiness view by Friday"
- CRM Research: "profile tenant data sizes"

**Draft top 3 for tomorrow**
1. … (id) · goal · ~est
2. …
3. …

**Tomorrow**: 3 meetings, 3h free; prep: skim the pen-test scope before the 10:00

**Inbox**: 4 items, 2 stale
```

Omit empty blocks. Finish in chat with the same summary and offer: *"Want me to capture any of
those, or adjust tomorrow's three?"* On a yes, capture per `meeting-capture.md`. If the Inbox
had stale items, also offer to triage it (`triage-inbox.md`).
