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
export const groupActionFor = (action: Action): GroupAction | null => {
  if (action.action === 'volume') return { intent: 'volume', level: action.level }
  if (action.action === 'mute') return { intent: 'mute', muted: action.muted }
  return null
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
