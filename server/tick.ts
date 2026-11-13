// One tick of the polling loop, in two steps that must not be separated.
//
// The polls run in parallel and answer in their own order, but the state they
// feed is served as it stands: `/api/state` reads the live objects, with no
// snapshot in between. Applied as they arrive, a reader served before the group
// pass sees a half-built tick. Measured on the running fleet (13/11, 1200
// samples at 150 ms): a member holding the answer `parseGroup` made of its own
// payload (`group "1"`, no name, no members) next to the mirror of the previous
// pass, in one sample out of five, for as long as the slow speakers of the fleet
// take to time out. That is the whole tick, on a fleet with a speaker offline.
//
// On its own that is a wrong-looking answer nobody sees. The visible half comes
// from the master: `multiroom:getSlaveList` answers hollow for a poll now and
// then while it streams (measured: seven single-poll gaps in two minutes). Land
// that answer in the same window and the master is patched as a speaker that
// drives no group, while its member still names it as its master: the card
// splits in two and comes back at the next pass. The twelve-second hold that
// exists for exactly this answer cannot help, because it only runs in the pass
// that has not happened yet.
//
// So the answers are applied first and the fleet is handed over second, with no
// await in between: nothing can be served in the gap, and a reader sees the
// fleet as of the end of the previous pass or as of the end of this one.
export const settlePolls = <T>(
  polls: readonly PromiseSettledResult<T>[],
  apply: (answer: T) => void,
  reconcile: () => void
): void => {
  for (const poll of polls) {
    if (poll.status === 'fulfilled') apply(poll.value)
  }
  // A pass with nothing to apply still runs: when every poll failed, the group
  // hold has to be given the chance to expire instead of freezing the last
  // answer for good.
  reconcile()
}
