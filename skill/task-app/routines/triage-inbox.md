# Routine: triage the Inbox (on demand; also step 2 of the weekly review)

Trigger: "triage my inbox", "process my inbox", "clear the inbox", "file my inbox", or a yes to
the shutdown's stale-Inbox offer.

Goal: every Inbox item has a proposed home, and the user decides. **Propose, then act**: nothing
moves until the user answers. In an unattended run (e.g. inside the weekly review), write the
proposals and change nothing.

This routine sorts what's *already* in the Inbox. It's the opposite of `task-app capture`, which
puts things into the Inbox.

## 1. Gather (read-only)

```bash
task-app review --json     # inbox (with ageDays / stale), projects, goals, waiting
task-app list all --json   # existing project/area names and open tasks, for filing and dedup
```

If the Inbox is empty, say "Inbox: empty ✓" and stop.

## 2. Propose, per item

Oldest first. Items with `stale: true` (3+ days) get flagged. For each one, pick **one** outcome:

- **File** → `move --project P` or `move --area A`. Names must match an existing project/area
  exactly. If nothing fits, file it in the closest area and say so, or suggest a new project
  as a separate question. Never create one silently.
- **Someday** → `move --someday`, for real but not now.
- **Waiting-on** → someone else owes the user something (the title often names them:
  "Chase Sam for…", "Sam to send…"). Propose `edit --waiting "Sam" --followup <date>`
  (default: 2 working days out) and file it as above. Take the name out of the title if it's
  now redundant.
- **Duplicate** → another open task already covers it (compare meaning, not wording). Propose
  a drop, naming the task it duplicates by id.
- **Done already** → the user may have done it without ticking it off. Propose it only if
  there's evidence (a note or email saying so). Otherwise ask.
- **Drop** → no longer relevant. There's no delete command, so a drop is
  `edit --tag dropped` then `complete`. That keeps a record in the Logbook. Mention that
  the user can delete the line in Obsidian if they'd rather it went entirely.

Alongside filing, suggest these only when the item or its context supports them: a date
(`--scheduled` for when to start, `--due` only for a real deadline), `--goal` when the link is
obvious (tasks in a goal-linked project inherit it anyway), and `--est` if the user usually
gives estimates. A date by itself doesn't take a task out of the Inbox, so it has to go with a
move.

Don't rewrite titles unless one is unclear or contains a name that's now in `--waiting`. If
you can't tell what an item means, don't guess. Ask.

## 3. Show and apply

In chat, as one numbered list the user can answer in one line ("all yes, except 3 Someday, 5
keep"):

```
Inbox: 6 items, 2 stale

1. Write the weekly status update (k3Jd9sQa) → project Website Relaunch · scheduled Fri
2. Ask Robin about Casey joining the data migration (ab12cd34) → project Data Migration
3. ⚠ 5d  Look into standing desk (Qx81mT2v) → Someday
4. ⚠ 4d  Sam to send pen-test scope (Lm3pW7cd) → waiting on Sam, follow up Thu · area Security
5. Book dentist (Zz9kR4aa) → drop? duplicates "Call dentist" (Ab4nH6ty)
6. "CRM thing" (Pp2sL0qe) → ? unclear, what is this?
```

Apply only the items the user approves, with the CLI (`move`, `edit`, `complete`). "Keep"
means leave it in the Inbox. Then run `task-app list inbox` and report what's left in one line.

If this runs inside the weekly review, the list goes in the review's **Inbox** block and the
decisions join the review's own numbered list.
