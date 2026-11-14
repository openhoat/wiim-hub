// The group gestures and how a fanned-out answer is read.
//
// A group write is not one request, so a refusal is not one boolean: the server
// answers a result per write, and the page has to name the speaker that failed
// rather than say "the command failed" over a group of two. Measured on a real
// group (documented in docs/feature-research.md §5.8.1): the master's volume
// moves alone, its mute reaches the group, so those two gestures do not travel
// the same path.
import type { Action, CommandResult, GroupAction } from './api'
import type { Device } from './types'

// The two gestures the group card carries. Everything else stays a device write:
// the transport runs on the master, and a member has no stream of its own.
//
// The group volume is not here: it is a card-level gesture, because the level it
// carries is the loudest speaker's and every row has to follow the thumb while it
// moves (`useGroupVolume`). `groupActionFor` answers the one group gesture that
// is a single write, the mute, and both callers of this module know the
// difference.
export const groupActionFor = (action: Action): GroupAction | null => {
  if (action.action === 'mute') return { intent: 'mute', muted: action.muted }
  return null
}

// The speaker a group gesture turns: the loudest one the hub still reads. A
// group whose rooms sit at 40 and 60 belongs to the room at 60, which is the
// level the slider shows and the one a gesture names.
//
// A speaker the fleet cannot read keeps its last value on screen but cannot
// carry the gesture: nothing would move it, and its ratio would set the pace of
// every other speaker from a level that no longer exists.
export const groupAnchor = (speakers: readonly Device[]): Device | null => {
  let anchor: Device | null = null
  for (const device of speakers) {
    if (!device.online || device.volume === null) continue
    if (anchor === null || (anchor.volume ?? 0) < device.volume) anchor = device
  }
  return anchor
}

// The ceiling the device reports, with the same fallback the player uses: a
// missing field never produces a level that cannot be reached.
export const groupCeiling = (device: Device): number =>
  device.maxVolume !== null && device.maxVolume > 0 ? device.maxVolume : 100

// The level a speaker lands on, from the one that carries the gesture. The hub
// plans with the same formula (`server/group-commands.ts`) and the duplication is
// deliberate: the image serves only `server/`, and the page needs the projection
// locally to follow the thumb without a read per pixel.
//
// Nothing to scale against (a speaker at zero, one not read yet) lands on the
// level itself, clamped to the ceiling.
export const scaledGroupLevel = (
  level: number,
  from: number | null,
  to: number | null,
  ceiling: number
): number => {
  if (from === null || from === 0 || to === null) return Math.min(level, ceiling)
  return Math.min(ceiling, Math.max(0, Math.round((level * to) / from)))
}

// The first write that did not answer `OK`, with its command and the raw body:
// a member that refused is named, and what it said is kept, because "Failed" on
// its own says nothing about which speaker to look at.
export const groupFailure = (results: readonly CommandResult[]): string | null => {
  const failed = results.find(result => !result.ok)
  if (failed === undefined) return null
  const body = failed.body.trim()
  return body === '' ? failed.command : `${failed.command}: ${body}`
}

// A master candidate for a speaker that drives nothing: an online speaker that
// is not a member itself, and that published the uuid a join names it by. One
// that did not answer a uuid is left out: the plan would refuse it, and offering
// a choice that cannot work is worse than offering none.
export const joinTargets = (fleet: readonly Device[], self: Device): Device[] =>
  fleet.filter(
    device =>
      device.online && device.uuid !== '' && device.group.role !== 'member' && device.ip !== self.ip
  )
