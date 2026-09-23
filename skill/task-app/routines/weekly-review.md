# Routine: weekly review (Friday 16:00)

Goal: a clean slate for next week. Everything is captured, the Inbox is empty or has a
proposal for each item, follow-ups are chased, each goal has a next action, and there's an
honest read on the week. It also covers Friday's shutdown. The output goes to Friday's daily
note under `## Weekly Review`. **Propose only**: list proposed moves, dates and drops, and
apply them only when the user says so.

Timezone: Pacific/Auckland. Today = `date +%F`; the week = the last 7 days.

## 1. Gather (read-only)

```bash
task-app review --json
task-app notes --since <today-6> --json   # the whole week's notes, for capture misses
task-app goals --json
task-app doctor                           # vault health (report it; don't --fix unattended)
```

For each weekday this week (skip missing notes): `task-app note show --date <d> --json`, to
read each day's Plan (planned top 3) and Shutdown.
Calendar: next week's events (Mon–Fri), to judge next week's capacity.

## 2. Work through the checklist

1. **Capture**: action lines in this week's notes that no captured task covers.
2. **Inbox**: for each item, propose a destination (project/area/Someday), a date, or a drop.
   Items older than 3 days get flagged.
3. **Waiting-on**: follow-ups overdue, and waits with no follow-up date (propose one).
4. **Goals**: for each goal, what moved this week (done tasks), and whether it has a next
   action. A goal with `noActiveTask` needs one: suggest a concrete first step drawn from the
   notes where possible, clearly marked as a suggestion.
5. **Projects**: flag `noNextAction`.
6. **Stale**: open 21+ days with no date. Propose schedule, Someday, or drop.
7. **The week in numbers**: planned focus tasks (from each day's Plan) vs. completed; tasks
   done per goal; roughly how many hours of meetings the calendar showed.
8. **Next week**: a first-pass top 3 for Monday, plus anything with a deadline next week.

## 3. Write

Pipe into `task-app note write --section "Weekly Review"`. Use the checklist headings, skip any
that are clean ("Inbox: empty ✓" is enough), and keep it to about one screen. Include Friday's
shutdown lines (done / carry-over) at the top, since the 16:30 shutdown doesn't run on Fridays.

Finish in chat: the 3–5 decisions the user needs to make, as a numbered list they can answer
with "1 yes, 2 Someday, …". Apply the answers with the CLI (`move`, `edit --followup`,
`project --goal`, `add`), then run `task-app sweep`.
