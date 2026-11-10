import type { DeviceState, PlaybackMirror } from './device/index.ts'
import type { GroupMember, GroupParent } from './device/multiroom.ts'

// The gap this file closes: a member of a multiroom group answers almost
// nothing about its group. `getStatusEx.group` is a bare "1", its own registry
// (`multiroom:getnamegrouplist`) is empty because the group is remembered on
// the speaker that drives it, and `getPlayerStatus` reports `mode 99, stop`
// with no track: the stream runs on the master and the member only renders it.
//
// Read alone, such a device looks like a stopped speaker in no group. Read with
// the fleet, it is a member of a named group playing a known track. The hub
// polls both speakers itself, so it can join the two answers without asking
// either device anything more, and without inventing a value: everything copied
// here comes from the master's last poll, and the copy names its source.
//
// This is a view, not a measurement: the member's own fields stay untouched, the
// mirror is a separate field, and a card that shows it says where it comes from.

const normalize = (value: string): string => value.trim().toLowerCase()

// The uuid would be the surest key, but a member does not report one: only the
// master lists it. The address is what the master publishes for a running group
// and what the hub polls, so it comes first; a saved group carries no address,
// which is why the name is the fallback.
const isMember = (member: GroupMember, state: DeviceState): boolean => {
  if (member.ip !== '' && member.ip === state.ip) return true
  if (member.ip !== '') return false
  const name = normalize(member.name)
  return name !== '' && name === normalize(state.name)
}

const masterOf = (states: readonly DeviceState[], state: DeviceState): DeviceState | null => {
  for (const candidate of states) {
    if (candidate === state) continue
    if (!candidate.online || candidate.group.role !== 'master') continue
    if (!candidate.group.members.some(member => isMember(member, state))) continue
    return candidate
  }
  return null
}

// A member with a track of its own is not a member of a running group: some
// firmwares keep a local stream alive. The device's own answer wins, and the
// fleet adds nothing.
const playsItself = (state: DeviceState): boolean => state.title !== '' || state.status === 'play'

const mirrorOf = (master: DeviceState): PlaybackMirror | null => {
  if (master.status !== 'play' && master.status !== 'pause') return null
  return {
    from: { name: master.name, ip: master.ip },
    group: master.group.name,
    status: master.status,
    title: master.title,
    artist: master.artist,
    album: master.album,
    albumArt: master.albumArt,
    curposMs: master.curposMs,
    totalMs: master.totalMs,
    source: master.source,
    updatedAt: master.updatedAt,
  }
}

// One pass over the fleet, in place, after every device has answered: a group is
// a shared object, so it can only be resolved once all answers are in. A member
// whose master is not in the fleet keeps the empty group it reported, which is
// the truth the hub can stand behind.
export const reconcileGroups = (states: Iterable<DeviceState>): void => {
  const fleet = [...states]
  for (const state of fleet) {
    state.mirror = null
    if (state.group.role !== 'member') continue
    const master = masterOf(fleet, state)
    if (master === null) continue
    const parent: GroupParent = { name: master.name, ip: master.ip }
    state.group = {
      ...state.group,
      // A master that named no group leaves the name empty: the hub does not
      // guess a name from the members it lists.
      name: state.group.name === '' ? master.group.name : state.group.name,
      members: state.group.members.length > 0 ? state.group.members : master.group.members,
      parent,
    }
    if (playsItself(state)) continue
    state.mirror = mirrorOf(master)
  }
}
