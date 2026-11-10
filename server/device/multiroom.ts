import { isRecord, num, parseJson, text } from './payload.ts'
import { probeCommand } from './probes.ts'

// A member of a multiroom group. A running group carries the address the
// device knows for it; a saved group only keeps the name and the uuid the
// firmware assigned, which is not the MAC on every model.
export type GroupMember = { name: string; ip: string; uuid: string }

// The speaker that drives the group a member follows. A member cannot answer
// this itself: it keeps no registry and its status only says `group: "1"`, so
// the hub names the master from its own fleet (`server/groups.ts`).
export type GroupParent = { name: string; ip: string }

// Multiroom, read only for now. `role` is what this speaker does in the group,
// `members` is what the device lists right now, and `saved` says a persistent
// group exists through `current_group_id` while nothing runs. `name` comes from
// the registry, never from `GroupName`: that field carries the device's own
// name on this firmware ("Living Room" for a speaker in no group at all).
export type GroupState = {
  role: 'none' | 'master' | 'member'
  name: string
  members: GroupMember[]
  saved: boolean
  // Null unless the fleet pass found the master this member follows.
  parent: GroupParent | null
}

// The uuid is what the app joins a group with, so a member that lost its name
// is still worth listing.
const readMember = (entry: Record<string, unknown>): GroupMember | null => {
  const name = text(entry.name) || text(entry.Name)
  const uuid = text(entry.uuid) || text(entry.Uuid)
  const ip = text(entry.ip) || text(entry.Ip)
  if (name === '' && uuid === '') return null
  return { name: name === '' ? uuid : name, ip, uuid }
}

// The documented payload spells every key with a capital (`Slave_list`,
// `Slaves`); this firmware answers `slavelist` and `slaves`. Both are read and
// neither is assumed to be there.
const readMembers = (value: unknown): GroupMember[] => {
  if (!Array.isArray(value)) return []
  const members: GroupMember[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const member = readMember(entry)
    if (member !== null) members.push(member)
  }
  return members
}

type SavedGroup = { id: string; name: string; members: GroupMember[] }

// The registry is shared with `index.ts`, which passes the cached one to
// `parseGroup`: the type is named where a caller has to write it.
export type Registry = { at: number; groups: SavedGroup[]; current: string }
export type RegistryView = Omit<Registry, 'at'>

export const emptyRegistry = (): Registry => ({ at: 0, groups: [], current: '' })

// Same seam again: an answer the hub cannot read returns `null` rather than an
// empty registry, so a failed probe does not make the saved group vanish from
// the panel for a minute. A readable answer with no group is a real "nothing
// saved" and clears the view.
export const parseRegistry = (raw: string | null): RegistryView | null => {
  const parsed = parseJson(raw)
  if (parsed === null) return null
  const groups: SavedGroup[] = []
  if (Array.isArray(parsed.grouplist)) {
    for (const entry of parsed.grouplist) {
      if (!isRecord(entry)) continue
      const id = text(entry.group_id)
      if (id === '') continue
      groups.push({ id, name: text(entry.group_name), members: readMembers(entry.slavelist) })
    }
  }
  // `current_group_id` is kept by a player that drives no group at all here, so
  // a non-empty value means "the app points at that group", not "it is running".
  return { groups, current: text(parsed.current_group_id) }
}

const groupTtlMs = 60_000
export const groupCache = new Map<string, Registry>()

// The registry is what the vendor app remembers: groups survive a reboot, a
// running group does not. Someone edits a group rarely enough for the same
// minute-long cache the presets use.
export const groupsFor = async (ip: string, firmware: string): Promise<Registry> => {
  const cached = groupCache.get(ip)
  if (cached !== undefined && Date.now() - cached.at < groupTtlMs) return cached
  const parsed = parseRegistry(await probeCommand(ip, firmware, 'multiroom:getnamegrouplist'))
  const value: Registry =
    parsed === null ? (cached ?? emptyRegistry()) : { at: Date.now(), ...parsed }
  groupCache.set(ip, value)
  return value
}

// A member is the role the device claims, nothing inferred: a reported member
// list makes it a master, a group id in its status makes it a follower, and a
// saved group with nothing running stays a saved group rather than a fake
// offline member.
const groupRole = (drives: boolean, follows: boolean): GroupState['role'] => {
  if (drives) return 'master'
  return follows ? 'member' : 'none'
}

export const parseGroup = (
  raw: Record<string, unknown> | null,
  statusGroup: string,
  registry: Registry
): GroupState => {
  const reported = readMembers(raw?.Slave_list ?? raw?.slavelist ?? raw?.slave_list)
  const count = num(raw?.Slaves) ?? num(raw?.slaves) ?? reported.length
  const follows = statusGroup !== '' && statusGroup !== '0'
  const role = groupRole(count > 0 || reported.length > 0, follows)
  const saved = registry.groups.find(entry => entry.id === registry.current) ?? null
  return {
    role,
    name: saved?.name ?? '',
    members: role === 'none' ? (saved?.members ?? []) : reported,
    saved: saved !== null,
    // Only the fleet pass can answer this: a member's own registry is empty.
    parent: null,
  }
}
