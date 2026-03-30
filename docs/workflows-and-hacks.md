---
layout: default
title: Workflows and Hacks
---

# Workflows and Hacks

This page collects practical patterns that make Tulcase pay for itself.

## 1. Treat TODOs as a short-horizon system

Do not turn the TODO panel into a backlog graveyard.

Use it for:

- what must move today
- what should happen next
- what needs a concrete date

Move vague long-term ideas into notes instead.

## 2. Use commands as operational memory

If you have run a command more than three times and still need to think about its flags, it belongs in Tulcase.

Good command entries include:

- local startup commands
- packaging commands
- release commands
- test filters
- database import and export helpers

Keep labels task-oriented so scanning stays fast.

## 3. Store links by action, not by website

Folders like these tend to work better than generic buckets:

- `Current Project`
- `Deploy and Ops`
- `Vendor Portals`
- `Docs Worth Reopening`

This reduces the time spent browsing your own bookmark structure.

## 4. Use notes for durable decisions

Tulcase Notes are a good place for:

- release checklists
- incident notes
- architecture decisions
- environment setup reminders
- handover material

If the information should still help a week later, it should usually be a note.

## 5. Separate databases by mode

Named databases are useful for keeping contexts clean.

Practical splits:

- personal vs work
- client A vs client B
- production operations vs product development
- stable daily driver vs experimentation sandbox

## 6. Tag for retrieval, not decoration

Useful tags should help answer one of these questions:

- what area is this about
- what project is this for
- how urgent is it
- what kind of work is this

If a tag does not improve retrieval or triage, it is overhead.

## 7. Log time in small increments

Records are easier to maintain when captured right after the work block finishes.

Examples:

- `0:25 review auth diff`
- `1:10 fix build on Windows`
- `0:40 docs for release 1.3.10`

Short, factual note texts make monthly review much easier.

## 8. Use Notes and Commands together

A strong pattern is to keep an operating note next to a small set of commands.

Example:

- note: `Release ritual`
- commands: `Compile extension`, `Run tests`, `Package VSIX`, `Publish docs`

That combination reduces release friction and avoids missing a step.

## 9. Keep recurring tasks boring

Recurring actions work best for routine maintenance, not creative planning.

Good recurring examples:

- review open follow-ups every Monday
- prune stale links monthly
- package and test before weekly handoff
- clean command library every two weeks

## 10. Build your own lightweight cockpit

Tulcase becomes much more valuable when each module has one clear job:

- TODOs for action
- Notes for context
- Commands for execution
- Links for references
- Records for evidence

That separation keeps each surface simple and keeps the whole system fast.