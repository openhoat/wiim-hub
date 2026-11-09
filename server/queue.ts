import { commandOutcome } from './commands.ts'

// One writer per device. The device is a small embedded server: two concurrent
// writes can interleave, and a slider drag would otherwise emit dozens of
// requests whose answers arrive out of order. Commands are queued in order,
// except the families marked by `commandFor` (volume, seek) where only the
// last value matters: a pending one of the same family takes the new value in
// place, and every caller waiting on it gets the same final answer.
export type Outcome = { ok: boolean; unsupported: boolean; command: string; body: string }

// `send` answers with the device body, or null when the device could not be
// reached: the queue turns that into a failed outcome rather than dropping it.
export type Send = (key: string, command: string) => Promise<string | null>

export type WriteQueue = {
  enqueue: (key: string, command: string, family: string | null) => Promise<Outcome>
}

type Resolve = (outcome: Outcome) => void
type Job = { command: string; family: string | null; resolvers: Resolve[] }

export const createWriteQueue = (send: Send): WriteQueue => {
  const queues = new Map<string, Job[]>()
  const draining = new Set<string>()

  const drain = async (key: string): Promise<void> => {
    if (draining.has(key)) return
    draining.add(key)
    try {
      const queue = queues.get(key) ?? []
      while (queue.length > 0) {
        const job = queue.shift() as Job
        const body = await send(key, job.command)
        const outcome = { ...commandOutcome(body), command: job.command, body: body ?? '' }
        for (const resolve of job.resolvers) resolve(outcome)
      }
    } finally {
      draining.delete(key)
    }
  }

  const enqueue = (key: string, command: string, family: string | null): Promise<Outcome> =>
    new Promise(resolve => {
      const queue = queues.get(key) ?? []
      const pending = family === null ? undefined : queue.find(job => job.family === family)
      if (pending !== undefined) {
        pending.command = command
        pending.resolvers.push(resolve)
      } else {
        queue.push({ command, family, resolvers: [resolve] })
      }
      queues.set(key, queue)
      void drain(key)
    })

  return { enqueue }
}
