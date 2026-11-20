# Kanban

Board conventions follow the `task-format` rule: stable `#N` numbers, `[CATEGORY]` plus optional
`(P1|P2|P3)` in the Backlog, `[TAG]` in In Progress, and no Done column (git history is the
record). An item moved to In Progress keeps its number and gains a start timestamp.

Detailed requirements live in `docs/feature-research.md`; cards stay coarse and point there.
Fine grained work in progress goes to the gitignored `.scratch/<slug>/` directory, never here.

## Backlog

### #2 [UX] Add media session controls, from the lock screen of a phone (P3)

- [ ] Publish the transport of the card the page drives as a media session, so play, pause and
      next reach the group from the lock screen while the PWA is open
