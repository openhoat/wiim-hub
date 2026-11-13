// The polling tick applies every answer before the group pass, and does the two
// in one go. What these tests pin is the order, which is what keeps a reader
// from being served a fleet where one speaker is patched and the pass that makes
// sense of it has not run: `server/tick.ts` carries the measurements.
import { describe, expect, test, vi } from 'vitest'
import { settlePolls } from './tick.ts'

const fulfilled = <T>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value })
const timeout = (): PromiseSettledResult<string> => ({
  status: 'rejected',
  reason: new Error('timeout'),
})

describe('settlePolls', () => {
  test('applies every answer before it hands the fleet to the group pass', () => {
    const applied = new Set<string>()
    const seen: string[] = []
    settlePolls(
      [fulfilled('living room'), fulfilled('bedroom')],
      answer => {
        applied.add(answer)
        seen.push(`apply ${answer}`)
      },
      () => seen.push(`pass ${[...applied].join(',')}`)
    )
    expect(seen).toEqual(['apply living room', 'apply bedroom', 'pass living room,bedroom'])
  })

  test('skips the answer a speaker never gave, and still runs the pass', () => {
    const applied: string[] = []
    const reconcile = vi.fn()
    settlePolls([fulfilled('living room'), timeout()], answer => applied.push(answer), reconcile)
    expect(applied).toEqual(['living room'])
    expect(reconcile).toHaveBeenCalledOnce()
  })

  test('runs the pass when every poll failed, so a held group can expire', () => {
    const apply = vi.fn()
    const reconcile = vi.fn()
    settlePolls([timeout(), timeout()], apply, reconcile)
    expect(apply).not.toHaveBeenCalled()
    expect(reconcile).toHaveBeenCalledOnce()
  })
})
