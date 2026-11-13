import type { DeviceState, PlaybackMirror } from './device/index.ts'
import type { GroupMember, GroupParent } from './device/multiroom.ts'

// The gap this file closes: a member of a multiroom group answers almost
// nothing about its group. `getStatusEx.group` is a bare "1", its own registry
// (`multiroom:getnamegrouplist`) is empty because the group is remembered on the
// speaker that drives it, and `getPlayerStatus` reports `mode 99, stop`
// with no track: the stream runs on the master and the member only renders it.
//
// Read alone, such a device looks like a stopped speaker in no group. Read with
// the fleet, it is a member of a named group playing a known track. The hub
// polls both speakers itself, so it can join the two answers without asking
// either device anything more, and without inventing a value: everything copied
// here comes from the master's last poll, and the copy names its source.
//
// A running group also has to survive its own answers: the master's slave list
// comes back empty for a poll now and then while it streams (measured: seven
// single-poll drops in two minutes, while the member named its own master at
// every single poll). The pass therefore keeps the last list it really read for
// a short while, and prefers the master the member names itself.
//
// This is a view, not a measurement: the member's own fields stay untouched, the
// mirror is a separate field, and a card that shows it says where it comes from.

const normalize = (value: string): string => value.trim().toLowerCase()

// How long a group survives an answer that says nothing: four polls at the
// default 3 s cadence, which is more than the single-poll gaps measured. Past
// that, the silence is the truth and the group is gone.
export const groupGraceMs = 12_000

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

// The speaker a member names itself, when it publishes one: the address is the
// device's own answer, so it is preferred over anything the fleet infers. The
// master's role is deliberately not checked here: it is exactly the field that
// comes back empty for a poll now and then, and the member is not guessing.
const namedBy = (states: readonly DeviceState[], state: DeviceState): DeviceState | null => {
  const parent = state.group.parent
  if (parent === null || parent.ip === '') return null
  for (const candidate of states) {
    if (candidate === state || !candidate.online || candidate.ip !== parent.ip) continue
    return candidate
  }
  return null
}

const listedBy = (states: readonly DeviceState[], state: DeviceState): DeviceState | null => {
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

// What a real answer said, kept with the time it said it: the only thing a
// silent poll is allowed to reuse.
type HeldList = { name: string; members: GroupMember[]; saved: boolean; at: number }
type HeldParent = { parent: GroupParent; name: string; members: GroupMember[]; at: number }

export type GroupReconciler = (states: Iterable<DeviceState>, at?: number) => void

// One pass over the fleet, in place, after every device has answered: a group is
// a shared object, so it can only be resolved once all answers are in. A member
// whose master is not in the fleet keeps the empty group it reported, which is
// the truth the hub can stand behind.
//
// The hold lives in the closure: a fresh reconciler (a hub restart) trusts only
// what this pass reads, and a test can drive the clock instead of waiting.
export const createGroupReconciler = (graceMs = groupGraceMs): GroupReconciler => {
  const lists = new Map<string, HeldList>()
  const parents = new Map<string, HeldParent>()

  const holdMaster = (state: DeviceState, now: number): void => {
    if (!state.online) return
    if (state.group.role === 'master' && state.group.members.length > 0) {
      lists.set(state.ip, {
        name: state.group.name,
        members: state.group.members,
        saved: state.group.saved,
        at: now,
      })
      return
    }
    // A member is not a hollow master, even if it drove a group a moment ago.
    if (state.group.role === 'member') return
    const held = lists.get(state.ip)
    if (held === undefined) return
    if (now - held.at >= graceMs) {
      lists.delete(state.ip)
      return
    }
    // The role and the list come from the same empty answer: put back what the
    // last real one said, and leave the device's own fields alone. The list is
    // always one the master itself published, never a member assembled here.
    state.group = {
      ...state.group,
      role: 'master',
      name: state.group.name !== '' ? state.group.name : held.name,
      members: held.members,
      saved: held.saved || state.group.saved,
    }
  }

  return (states: Iterable<DeviceState>, at?: number): void => {
    const now = at ?? Date.now()
    const fleet = [...states]
    for (const state of fleet) holdMaster(state, now)

    for (const state of fleet) {
      state.mirror = null
      if (!state.online || state.group.role !== 'member') {
        parents.delete(state.ip)
        continue
      }
      // The device's own answer first, the master's list second: a member that
      // names its master is right at every poll, the list is not.
      const master = namedBy(fleet, state) ?? listedBy(fleet, state)
      const held = parents.get(state.ip)
      if (master !== null) {
        parents.set(state.ip, {
          parent: { name: master.name, ip: master.ip },
          name: master.group.name !== '' ? master.group.name : (held?.name ?? ''),
          members: master.group.members.length > 0 ? master.group.members : (held?.members ?? []),
          at: now,
        })
      }
      const kept =
        master !== null
          ? parents.get(state.ip)
          : held !== undefined && now - held.at < graceMs
            ? held
            : undefined
      // Nothing confirmed the group in this pass: the member keeps the parent it
      // named itself (an address the fleet does not poll is still a fact), and
      // the mirror stays empty because there is nothing to copy.
      if (kept === undefined) continue
      state.group = {
        ...state.group,
        // A master that named no group leaves the name empty: the hub does not
        // guess a name from the members it lists.
        name: state.group.name === '' ? kept.name : state.group.name,
        members: state.group.members.length > 0 ? state.group.members : kept.members,
        parent: kept.parent,
      }
      const source =
        master ??
        fleet.find(candidate => candidate.online && candidate.ip === kept.parent.ip) ??
        null
      if (playsItself(state) || source === null) continue
      state.mirror = mirrorOf(source)
    }
  }
}
