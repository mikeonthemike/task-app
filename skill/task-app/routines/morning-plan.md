# Routine: morning plan

Goal: by ~08:30, today's daily note has a short `## Plan`, plus a succinct `## Meetings` section, that the user (and anything else
that reads the note, such as a morning-brief skill) can read in 30 seconds. **Propose only**: the user confirms the top 3 before
anything is marked, and calendar blocks are never created without an explicit yes.

Use the timezone and working day from the skill's "Time and working hours". Get today's date
from `date +%F`.

## 1. Gather (read-only)

```bash
task-app review --json                              # focus, overdue, due soon, follow-ups, goal health, estimates
task-app note show --json                           # today's note: does a Plan already exist?
task-app note show --previous --section Shutdown    # last workday's shutdown: carry-overs + draft top 3
```

Calendar (your calendar connector, e.g. Google Calendar, on the user's primary calendar): today
00:00 → 23:59 local time. Work out the meetings, then the **free blocks of 45 minutes
or more** inside the working day. Ignore events the user declined. Treat tentative or
unanswered events as soft busy time (plan around them, but say so), and all-day events as
context, not busy time.

If `review.vaultIssues` isn't empty, mention it in one line; don't run `doctor --fix` unattended.

## 2. Decide

Pick **3 candidate focus tasks**. In order of preference:
1. The previous shutdown's "Draft top 3 for tomorrow" when it's still open and still makes sense.
2. Overdue or due today/tomorrow (`overdue`, `dueSoon`). A task that is overdue only by its ⏳
   (it's in `scheduledPastNoDue`) has no deadline, so rank it below real due dates. Don't re-date
   it here; the weekly review asks about those.
3. Work on a goal with `noActiveTask: false` that has had nothing done recently. If a goal has
   `noActiveTask: true`, don't invent a task for it: list it under "Needs a next action".
4. Otherwise the oldest meaningful open task on a goal-linked project.

Within each step, prefer important tasks (priority `medium` or above) over normal ones. An
urgent task that isn't important (due soon, normal or low priority) is a candidate for a quick
slot or a nudge to someone else, not automatically a top-3 pick.

Then check capacity: add up `estimateMinutes` for the 3 (estimating any that are missing, and
saying so) and compare with the free blocks. If it doesn't fit, say which one to drop, not "the
day is busy". Follow-ups in `waiting.followUpDue` are due today: list them, since each is
usually a two-minute nudge.

## 3. Write the Plan

Pipe the body into `task-app note write --section Plan`. Keep to this shape (plain lists,
**no `- [ ]` checkboxes**, ids in parentheses so they can be acted on):

```
_Proposed 08:30. Reply "confirm" (or swap one) to set focus._

**Top 3**
1. Agree WOW with Sam (k3Jd9sQa) · CRM · ~45m
2. …
3. …

**Focus blocks (proposed, not booked)**
- 10:00–11:00 → 1
- 14:00–14:45 → 2

**Follow-ups due**
- Morgan: GitHub access (Pq7x-Lm2)

**Watch**
- Acme: no next action · 4 goals with nothing open
- Day: 5h of meetings, only 1.5h free, so #3 probably slips
```

Omit any empty block. If a Plan already exists (a re-run), rewrite it; don't append a second one.
Meeting context goes in its own section (next step), not the Plan. At most, Watch can point to it
("Prep for Jordan 14:30: see Meetings").

## 4. Meeting context

Follow `meeting-prep.md` to write today's `## Meetings` section, reusing the calendar events and
`review --json` you already have. Gmail and Slack searches are read-only, so they're fine
unattended. If a Calendar fetch failed, skip this step and say so in one line.

## 5. Hand over

End the session with the same Top 3 in chat, plus one line per meeting that has a real `Raise`
or `Before` item (no more). Then ask: *"Confirm these three, or swap any?
I can also book the focus blocks."* When the user replies (this session or later):
- confirm or swap → `task-app focus <id> <id> <id>`, then rewrite the Plan's first line to
  `_Confirmed HH:MM._`
- "book the blocks" → create one calendar event per block, titled `Focus: <task title>`, with
  the task id in the description. Check for an existing `Focus:` event in that slot first, so
  booking twice doesn't duplicate.

Unattended runs never call `task-app focus`, never create calendar events, and never send messages.
