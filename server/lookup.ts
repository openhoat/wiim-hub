import type { DeviceState } from './device/index.ts'

// One device as the routes address it: the key it is polled under, and the state
// the last poll built. The key travels with the entry because commands are queued
// on it, not on the address printed in the state.
export type Lookup = { key: string; state: DeviceState }

// A caller may address a device three ways: by the key it is polled under (an
// address, an env entry, or a saved host), by the address it currently answers
// on, or by the name it reports. The name is the one a person knows, which is why
// the MCP client offers it, but it is not an identity: two speakers of the same
// model can report the same name. It is therefore accepted only when exactly one
// device carries it, and anything ambiguous falls back to the address, which
// always names one machine.
//
// An empty name matches nothing (a device that never answered reports none) and
// an empty host resolves to nothing, so a missing query string cannot land on
// whichever device happens to come first.
export const findDevice = (states: Map<string, DeviceState>, host: string): Lookup | null => {
  if (host === '') return null
  const direct = states.get(host)
  if (direct !== undefined) return { key: host, state: direct }
  for (const [key, state] of states) {
    if (state.ip === host) return { key, state }
  }
  let named: Lookup | null = null
  for (const [key, state] of states) {
    if (state.name === '' || state.name !== host) continue
    if (named !== null) return null
    named = { key, state }
  }
  return named
}
