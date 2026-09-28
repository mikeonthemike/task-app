# Routine: meeting context for the daily note

Goal: a `## Meetings` section in today's daily note that gives the user just enough to walk
into each meeting: what it's for, what's live, and what to raise. If the user has a standalone
meeting-prep skill, this is a compact version with the same sourcing rules; use that skill
instead when they ask for a full brief on one meeting.

Runs as step 3 of the morning plan, or on demand ("add prep for my 2pm to the note"). It's
read-only apart from `task-app note write`.

## The one rule

**Only write what you actually retrieved.** No generic talking points ("align on goals"), no
guessed background. If there's nothing for a meeting, it gets its basics line and nothing
else. A made-up talking point is worse than none.

## 1. Pick the meetings

Start from today's calendar events (already fetched by the morning plan). Leave out declined
events, all-day events and the user's own `Focus:` blocks. Everything else goes in one of two
lists:

- **Prep**: 1:1s, intros, small working sessions, anything where the invite has an objective
  or a named topic, and external meetings.
- **No prep**: socials, all-hands, company-wide or large group invites, and well-run recurring
  syncs with nothing new. They go in one line at the end, unless a source below turns up
  something specific for one of them.

## 2. Gather, per Prep meeting

Only follow leads the event itself gives you: attendee names and emails, topic or project words
in the title or description, linked docs. Favour the last couple of weeks, and use an older item
only if nothing recent covers it.

1. **Invite**: the description is often the best source ("Objective: … Context: …"). Also note
   who hasn't responded.
2. **The vault**: the user's own notes about this person or topic. Look for filenames and
   headings matching the attendee's name or the topic (e.g. `Intros/`, `Intro with JL.md`,
   `CRM Research.md`), newest first. Skim `## Notes` / `## Actions`. This is usually the
   highest-signal source, since it's what the user already knows and promised.
3. **Tasks**: from the `review --json` you already have (or `task-app list all --json`), any
   open task naming the attendee or topic, especially intro tasks, `#waiting/<person>` items
   (they owe the user something) and things the user owes them.
4. **Gmail**: one search on the attendee's email address from the last 30 days. Read a thread
   only if it looks substantive.
5. **Slack**: one search on the attendee's name and/or the topic keyword. For someone new,
   announcement or channel posts that show what they own are the useful part.

Skip a source when it can't add anything. If a connector is unavailable, carry on without it
and note that once at the end, not per meeting.

## 3. Write

Pipe into `task-app note write --section Meetings`. The format is strict, because the point is
to be succinct:

```
**09:00 Acme New Dev Model** · Robin K, Casey M
- For: (invite has no description)
- Live: Robin K leaving; new PM starts next week (Intro with Robin K.md)
- Raise: who owns sprint planning after Robin K

**10:00 Jordan Lee: intro** (Zb4hTy6N)
- For: introductions; understand their area (invite)
- Live: Jordan hasn't accepted yet
- Raise: where they see delivery gaps

_No prep: All Hands 13:30 · Team drinks 16:00 (tentative)_
```

Rules:
- One heading line per meeting: time, short title, and the key attendees only if the title
  doesn't already name them. Add the task id if an open task is about this meeting.
- **At most 3 bullets**, each under ~20 words, taken from `For` / `Live` / `Raise` / `Before`
  (something to read or do beforehand). Drop any bullet you have nothing real for. A meeting can
  have only its `For:` line.
- End each `Live` item with a short source in parentheses: the note name, `Slack #channel`,
  `email 22 Sep`, or `invite`. Tasks are cited by id.
- Every `Raise` must trace back to a `Live` item or the invite. If you can't point to one, leave
  it out.
- Meetings in time order, with the one-line `_No prep: …_` last. If a connector was unavailable,
  add one line at the very end: `_Not checked: Slack (not connected)._`

If `## Meetings` already exists (a re-run), rewrite it. Don't repeat any of this in the Plan: the
Plan's Watch block can say "Prep for Jordan: see Meetings" at most.
