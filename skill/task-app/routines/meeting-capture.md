# Routine: capture actions from meeting notes (on demand)

Trigger: "process my notes", "capture actions from today's meetings", "anything from the
Sam meeting?", or a yes to a shutdown/weekly "To capture?" list.

```bash
task-app notes --since <date> --json            # default today; use the date range asked for
task-app notes --since <date> --content --json  # when you need the full text, not just ## Actions
task-app list all --json                        # existing tasks, for dedup and project names
```

For each note:
1. Candidate actions come from its `## Actions` section first; for notes without one, from
   clear commitments in the body ("I'll…", "need to…", "X to send Y").
2. **Skip anything already covered.** Check the note's `captured` list and compare meaning,
   not wording. Also check open tasks generally, since the same action often appears in two notes.
3. Classify each remaining action:
   - the user owes it → a task
   - someone else owes the user → `--waiting "<Person>"` with a sensible `--followup`
     (default: 2 working days, or just before any date mentioned)
   - neither (an FYI or a decision already made) → skip it
4. File it. The note's frontmatter `Projects:` → `--project` if it matches an existing project
   exactly; else `area:` → `--area`; else the Inbox. `--goal` only when the link is obvious.
5. Always pass `--notes "From: <note name>.md"`. That's what dedup keys on next time. When
   you skip an action because an existing task already covers it, link that task instead:
   `task-app edit <id> --notes "From: <note name>.md"`. Otherwise the note still looks
   unprocessed and `task-app capture` would add the action again.

In an interactive session, show the list first (title, where it'll be filed, waiting/follow-up)
and add after a yes. Adding without asking is fine when the user has already approved that
exact list, e.g. "capture those" after a shutdown.

Write titles in the user's words: short, verb-first, with the person's name when it matters
("Send Sam the CRM readiness view"). Don't copy the raw note line verbatim unless it's already clean.
