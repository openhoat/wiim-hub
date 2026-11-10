import { fetchCommand } from './transport.ts'

// A device answers `unknown command` to a probe it does not implement, and that
// is a property of the build, not of the moment (`commandOutcome` in
// `commands.ts` reads the same token on the write side). Without a memory the
// hub asks again at every cache window, which is the whole cost the page pays
// for a feature the speaker will never have.
//
// The key carries the address as well as the firmware: a negative learned from
// one model must not hide a capability another model has, even when both report
// the same build string. A firmware update changes the key, so the probe is
// asked once against the new build.
const remembered = new Map<string, number>()

// A day is a safety valve, not a claim: the answer is a capability, so it does
// not change on its own, but a speaker that answered during a wobble must not
// stay silent until its next update either.
export const probeCacheTtlMs = 86_400_000

// The window shared by the probes whose answer is static for a firmware (input
// and output lists, factory curves, room correction): five minutes, as the page
// has always allowed.
export const slowProbeTtlMs = 300_000

export const probeKey = (ip: string, firmware: string, command: string): string =>
  `${ip}|${firmware}|${command}`

// The exact token, as the firmware spells it: anything else is an answer the
// probe must keep paying for.
export const isUnsupportedAnswer = (answer: string | null): boolean =>
  answer !== null && /^unknown command$/i.test(answer.trim())

export const probeDue = (
  rememberedAt: number | undefined,
  now: number,
  ttlMs = probeCacheTtlMs
): boolean => rememberedAt === undefined || now - rememberedAt >= ttlMs

// One probe, with the negative answers remembered. A suppressed probe answers
// `null`, which every parser already tolerates: they keep the value they knew
// rather than turning the panel off.
export const probeCommand = async (
  ip: string,
  firmware: string,
  command: string
): Promise<string | null> => {
  const key = probeKey(ip, firmware, command)
  if (!probeDue(remembered.get(key), Date.now())) return null
  const answer = await fetchCommand(ip, command)
  if (isUnsupportedAnswer(answer)) remembered.set(key, Date.now())
  return answer
}
