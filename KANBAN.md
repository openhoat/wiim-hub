# Kanban

Board conventions follow the `task-format` rule: stable `#N` numbers, `[CATEGORY]` plus optional
`(P1|P2|P3)` in the Backlog, `[TAG]` in In Progress, and no Done column (git history is the
record). An item moved to In Progress keeps its number and gains a start timestamp.

Detailed requirements live in `docs/feature-research.md`; cards stay coarse and point there.
Fine grained work in progress goes to the gitignored `.scratch/<slug>/` directory, never here.

## Backlog

### #4 [UX] Add a multiroom group view with per member control (P2)

[//]: # Blocked on a second reachable unit: the member payload of `multiroom:getSlaveList` (with members) and the join/leave/kick semantics cannot be measured while only one speaker answers. The read side shipped in 0.4.3; the writes wait.

- [x] Read the role from `multiroom:getSlaveList` and render master, members and orphans
- [ ] Per member volume and mute with coalescing, plus one synchronised volume control
- [ ] Join, leave and kick out with a confirmation naming the device and the raw answer on failure
- [ ] Reconcile the group state after every write instead of trusting the optimistic view

### #14 [I18N] Complete the French copy and localise the formats (P3)

- [ ] Review every string in context, including the diagnostic findings and the guided flows
- [ ] Localise numbers, dates and durations through `Intl`, with no concatenated sentences
