// The multiroom writes. `commands.ts` turns one intent into one command against
// one device; a group write is not that. One gesture has to reach the master and
// every member, each with its own request, its own coalescing family and its own
// answer, and the plan depends on who follows whom. `server/groups.ts` already
// resolved that from the fleet, so the plan is built from what the hub confirmed
// and never from what the page believes.
//
// Measured on a real group of two units (10/11/2026, firmware Linkplay.4.6,
// `wmrm_version` 4.3). Two results drive the shapes below:
//
//   - there is no group volume: the master's `setPlayerCmd:vol` moves the master
//     alone, and the documented `setPlayerCmd:slave_vol` moves the master too.
//     So a group volume is one write for the master plus one per member.
//   - there is a group mute, because the master's own mute propagates to the
//     members and to the member list. One write, no fan-out.
//
// The two paths disagree on purpose: each follows its measurement, and neither
// follows the documentation.
import type { DeviceState } from './device/index.ts'
import type { GroupMember } from './device/multiroom.ts'

export type GroupIntent =
  | { intent: 'volume'; level: number }
  | { intent: 'mute'; muted: boolean }
  | { intent: 'memberVolume'; member: string; level: number }
  | { intent: 'memberMute'; member: string; muted: boolean }
  | { intent: 'join'; master: string }
  | { intent: 'leave' }
  | { intent: 'kick'; member: string }
  | { intent: 'ungroup' }

// One request on the speaker that receives it. `key` is the write queue key of
// that speaker, so the two spellings of one machine never run two writers; for
// every command but `join` and `leave` the receiving speaker is the master.
export type GroupWrite = { key: string; command: string; family: string | null }
export type GroupPlan = { writes: GroupWrite[] } | { error: string }

// A speaker and the key the hub polls it under.
export type FleetUnit = { key: string; state: DeviceState }

export type ParsedGroup = { intent: GroupIntent } | { error: string }

const maxLevel = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const integer = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return Number.isFinite(value) ? value : null
}

const levelField = (fields: Record<string, unknown>): number | null => {
  const level = integer(fields.level)
  return level !== null && level >= 0 && level <= maxLevel ? level : null
}

const flagField = (fields: Record<string, unknown>, key: string): boolean | null => {
  const value = fields[key]
  return typeof value === 'boolean' ? value : null
}

// An address the device itself published, so it is checked for shape rather than
// resolved: a name here would be a value no speaker reported.
const addressField = (fields: Record<string, unknown>, key: string): string | null => {
  const value = fields[key]
  if (typeof value !== 'string' || value.length === 0 || value.length > 45) return null
  return value.trim() === value ? value : null
}

const accept = (intent: GroupIntent): ParsedGroup => ({ intent })
const refuse = (error: string): ParsedGroup => ({ error })

type Parser = (fields: Record<string, unknown>) => ParsedGroup

const parsers: Record<string, Parser> = {
  volume: fields => {
    const level = levelField(fields)
    return level === null ? refuse('invalid volume level') : accept({ intent: 'volume', level })
  },
  mute: fields => {
    const muted = flagField(fields, 'muted')
    return muted === null ? refuse('invalid mute flag') : accept({ intent: 'mute', muted })
  },
  memberVolume: fields => {
    const member = addressField(fields, 'member')
    const level = levelField(fields)
    if (member === null) return refuse('invalid member address')
    return level === null
      ? refuse('invalid volume level')
      : accept({ intent: 'memberVolume', member, level })
  },
  memberMute: fields => {
    const member = addressField(fields, 'member')
    const muted = flagField(fields, 'muted')
    if (member === null) return refuse('invalid member address')
    return muted === null
      ? refuse('invalid mute flag')
      : accept({ intent: 'memberMute', member, muted })
  },
  join: fields => {
    const master = addressField(fields, 'master')
    return master === null ? refuse('invalid master address') : accept({ intent: 'join', master })
  },
  leave: () => accept({ intent: 'leave' }),
  kick: fields => {
    const member = addressField(fields, 'member')
    return member === null ? refuse('invalid member address') : accept({ intent: 'kick', member })
  },
  ungroup: () => accept({ intent: 'ungroup' }),
}

// `Object.hasOwn` for the same reason as `parseAction`: a body is untrusted JSON
// and the prototype is not a group write.
export const parseGroupIntent = (body: unknown): ParsedGroup => {
  if (!isRecord(body)) return refuse('body must be an object')
  const name = body.intent
  if (typeof name !== 'string') return refuse('missing intent')
  const parser = Object.hasOwn(parsers, name) ? parsers[name] : null
  if (parser === null) return refuse(`unknown intent ${name}`)
  return parser(body)
}

// The member list is the only thing that names a member: the hub refuses to
// address one the master does not list, which is what a page rendered before the
// group changed would send.
const memberOf = (state: DeviceState, ip: string): GroupMember | null =>
  state.group.members.find(member => member.ip === ip) ?? null

const ceilingOf = (unit: FleetUnit): number => unit.state.maxVolume ?? maxLevel

const unitAt = (fleet: readonly FleetUnit[], ip: string): FleetUnit | null =>
  fleet.find(unit => unit.state.ip === ip) ?? null

const requireMaster = (target: FleetUnit): string | null =>
  target.state.group.role === 'master' ? null : 'this speaker does not drive a group'

const requireMember = (target: FleetUnit, member: string): string | null => {
  if (memberOf(target.state, member) === null) return `unknown group member: ${member}`
  return null
}

const memberWrites = (target: FleetUnit, command: (ip: string) => GroupWrite): GroupWrite[] =>
  target.state.group.members.filter(member => member.ip !== '').map(member => command(member.ip))

// The master's own volume moves alone, so a group volume is every speaker's
// volume. Each member gets its own coalescing family: a drag then leaves one
// pending value per speaker instead of forty, and the master's own value is not
// overwritten by a member's.
const volumeWrites = (level: number, target: FleetUnit, fleet: readonly FleetUnit[]): GroupPlan => {
  const members = target.state.group.members
    .map(member => unitAt(fleet, member.ip))
    .filter((unit): unit is FleetUnit => unit !== null)
  const tooLoud = [target, ...members].find(unit => level > ceilingOf(unit))
  if (tooLoud !== undefined) {
    return { error: `volume above the device ceiling (${ceilingOf(tooLoud)})` }
  }
  const own: GroupWrite = {
    key: target.key,
    command: `setPlayerCmd:vol:${level}`,
    family: 'volume',
  }
  return {
    writes: [
      own,
      ...memberWrites(target, ip => ({
        key: target.key,
        command: `multiroom:SlaveVolume:${ip}:${level}`,
        family: `volume:${ip}`,
      })),
    ],
  }
}

// One write on the master: measured, its mute reaches the members on its own,
// and the next poll reads what each member did with it.
const muteWrite = (muted: boolean, target: FleetUnit): GroupWrite => ({
  key: target.key,
  command: `setPlayerCmd:mute:${muted ? 1 : 0}`,
  family: null,
})

const joinWrites = (
  intent: Extract<GroupIntent, { intent: 'join' }>,
  target: FleetUnit,
  fleet: readonly FleetUnit[]
): GroupPlan => {
  // The guest receives the join, so the command names the master: the address
  // the hub polls, and the uuid the master published. A master that answers no
  // uuid cannot be joined, and the hub says so rather than sending a command the
  // device accepts while grouping nothing.
  if (target.state.ip === intent.master) return { error: 'a speaker cannot join itself' }
  if (target.state.group.parent?.ip === intent.master) {
    return { error: 'already a member of this group' }
  }
  // The guest's own `status.group` is not evidence: measured, it stays `'1'` for
  // a few seconds after a kick, and it says `'1'` for a master the hub cannot
  // see. Only a master in the fleet that lists this speaker proves it follows
  // something, so that is the one case refused.
  if (target.state.group.role === 'member' && target.state.group.parent !== null) {
    return { error: 'this speaker already follows another group' }
  }
  const master = unitAt(fleet, intent.master)
  if (master === null) return { error: `unknown group master: ${intent.master}` }
  if (!master.state.online) return { error: 'the group master is offline' }
  if (master.state.group.role === 'member')
    return { error: 'this speaker follows a group of its own' }
  if (master.state.uuid === '') return { error: 'the group master published no uuid' }
  if (!target.state.online) return { error: 'device offline' }
  return {
    writes: [
      {
        key: target.key,
        command: `multiroom:JoinGroup:IP=${master.state.ip}:uuid=${master.state.uuid}`,
        family: null,
      },
    ],
  }
}

// A write the master carries alone, once the hub has checked that the speaker
// does drive a group.
const masterPlan = (target: FleetUnit, write: () => GroupWrite): GroupPlan => {
  const error = requireMaster(target)
  return error === null ? { writes: [write()] } : { error }
}

// The same check for a gesture addressed to one member: the master must drive
// the group and must list that speaker, which is the only thing that names a
// member.
const memberPlan = (target: FleetUnit, member: string, write: () => GroupWrite): GroupPlan => {
  const error = requireMaster(target) ?? requireMember(target, member)
  return error === null ? { writes: [write()] } : { error }
}

const volumePlan = (
  intent: Extract<GroupIntent, { intent: 'volume' }>,
  target: FleetUnit,
  fleet: readonly FleetUnit[]
): GroupPlan => {
  const error = requireMaster(target)
  return error === null ? volumeWrites(intent.level, target, fleet) : { error }
}

// The member's own ceiling, not the master's: a Mini and a Pro do not stop at
// the same level, and the master's list does not publish it.
const memberVolumePlan = (
  intent: Extract<GroupIntent, { intent: 'memberVolume' }>,
  target: FleetUnit,
  fleet: readonly FleetUnit[]
): GroupPlan => {
  const error = requireMaster(target) ?? requireMember(target, intent.member)
  if (error !== null) return { error }
  const member = unitAt(fleet, intent.member)
  if (member !== null && intent.level > ceilingOf(member)) {
    return { error: `volume above the device ceiling (${ceilingOf(member)})` }
  }
  return {
    writes: [
      {
        key: target.key,
        command: `multiroom:SlaveVolume:${intent.member}:${intent.level}`,
        family: `volume:${intent.member}`,
      },
    ],
  }
}

const leavePlan = (target: FleetUnit): GroupPlan => {
  if (target.state.group.role !== 'member') return { error: 'this speaker follows no group' }
  return { writes: [{ key: target.key, command: 'multiroom:LeaveGroup', family: null }] }
}

export const groupPlanFor = (
  intent: GroupIntent,
  target: FleetUnit,
  fleet: readonly FleetUnit[]
): GroupPlan => {
  switch (intent.intent) {
    case 'volume':
      return volumePlan(intent, target, fleet)
    case 'mute':
      return masterPlan(target, () => muteWrite(intent.muted, target))
    case 'memberVolume':
      return memberVolumePlan(intent, target, fleet)
    case 'memberMute':
      return memberPlan(target, intent.member, () => ({
        key: target.key,
        command: `multiroom:SlaveMute:${intent.member}:${intent.muted ? 1 : 0}`,
        family: null,
      }))
    case 'kick':
      return memberPlan(target, intent.member, () => ({
        key: target.key,
        command: `multiroom:SlaveKickout:${intent.member}`,
        family: null,
      }))
    case 'ungroup':
      return masterPlan(target, () => ({
        key: target.key,
        command: 'multiroom:Ungroup',
        family: null,
      }))
    case 'leave':
      return leavePlan(target)
    case 'join':
      return joinWrites(intent, target, fleet)
  }
}
