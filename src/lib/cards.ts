import type { Device, GroupMember } from './types'

// A running group is one player, so the page draws one card for it: the speaker
// that drives the group carries the cover, the track and the transport, and the
// speakers that follow it become rows inside that card, as the vendor app does.
// Drawn the other way, three speakers showed the same cover three times and a
// member card had nothing of its own left to say.
//
// The fleet pass decides who follows whom (`server/groups.ts` sets `parent` from
// the master's own answer): this file only groups what the hub confirmed, and
// never invents a membership the speakers did not report.
export type FleetCard = {
  // The address the card is keyed on, which is the master's: the order the
  // reader pinned follows the group, not its members.
  ip: string
  master: Device
  // Speakers the hub polls that follow this one, in the order the master named
  // them.
  members: Device[]
  // Members the master names but the fleet does not poll: they keep a row with
  // their name and no address, which is what a remembered member is.
  absent: GroupMember[]
}

const normalize = (value: string): string => value.trim().toLowerCase()

// The same rule the fleet pass uses: the address when the master published one,
// the name otherwise, since a saved group carries no address.
export const sameMember = (member: GroupMember, device: Device): boolean => {
  if (member.ip !== '') return member.ip === device.ip
  const name = normalize(member.name)
  return name !== '' && name === normalize(device.name)
}

// A speaker that plays something of its own is not rendering the group: some
// firmwares keep a local stream alive. Its own answer wins, so it keeps its card
// instead of disappearing into the master's.
const playsItself = (device: Device): boolean => device.title !== '' || device.status === 'play'

const driverOf = (device: Device, byIp: ReadonlyMap<string, Device>): Device | null => {
  const parent = device.group.parent
  if (device.group.role !== 'member' || parent === null) return null
  if (playsItself(device)) return null
  const master = byIp.get(parent.ip)
  if (master === undefined || master.ip === device.ip) return null
  // A master is a speaker the fleet itself reports as one, and one that still
  // answers: a saved group and a speaker that stopped answering both leave the
  // cards apart, since nothing currently confirms the group runs.
  return master.online && master.group.role === 'master' ? master : null
}

const orderedMembers = (master: Device, followers: readonly Device[]): Device[] => {
  const ordered: Device[] = []
  const taken = new Set<string>()
  for (const entry of master.group.members) {
    const match = followers.find(follower => !taken.has(follower.ip) && sameMember(entry, follower))
    if (match === undefined) continue
    taken.add(match.ip)
    ordered.push(match)
  }
  // A follower the master's list does not name (a list read before the group
  // grew) is still a follower: it goes last rather than vanishing.
  return [...ordered, ...followers.filter(follower => !taken.has(follower.ip))]
}

// One pass over the fleet, like the group reconciliation it depends on: a card
// is drawn per speaker the page still has to show, and a member's card is gone
// the moment the master confirms it follows.
export const fleetCards = (devices: readonly Device[]): FleetCard[] => {
  const byIp = new Map(devices.map(device => [device.ip, device]))
  const followers = new Map<string, Device[]>()
  for (const device of devices) {
    const master = driverOf(device, byIp)
    if (master === null) continue
    const list = followers.get(master.ip) ?? []
    list.push(device)
    followers.set(master.ip, list)
  }
  const merged = new Set([...followers.values()].flat().map(device => device.ip))

  return devices
    .filter(device => !merged.has(device.ip))
    .map(master => {
      const members = orderedMembers(master, followers.get(master.ip) ?? [])
      return {
        ip: master.ip,
        master,
        members,
        // A member the master names and the fleet does not poll stays a row of
        // its own; one the fleet does poll is either merged above or drawn on
        // its own card, and repeating it here would show it twice.
        absent: master.group.members.filter(
          entry => !devices.some(device => sameMember(entry, device))
        ),
      }
    })
}

// The name the card announces: the group's when the speaker drives one, since
// that is the thing the reader sees in the room, and the speaker's otherwise.
export const cardTitle = (card: FleetCard): string => {
  const named = card.master.group.name !== ''
  return card.members.length + card.absent.length > 0 && named
    ? card.master.group.name
    : card.master.name
}
