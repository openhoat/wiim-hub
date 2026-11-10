import { describe, expect, it } from 'vitest'
import type { HubAnswer, HubClient, Query } from './hub.ts'
import { type ToolContext, toolByName, tools } from './tools.ts'

type Call = { method: 'GET' | 'POST'; path: string; query: Query; body: unknown }

const fakeHub = (answers: {
  get?: HubAnswer
  post?: HubAnswer
}): { hub: HubClient; calls: Call[] } => {
  const calls: Call[] = []
  const hub: HubClient = {
    baseUrl: 'http://hub.test',
    get: async (path, query = {}) => {
      calls.push({ method: 'GET', path, query, body: null })
      return answers.get ?? { status: 200, ok: true, body: {} }
    },
    post: async (path, query, body) => {
      calls.push({ method: 'POST', path, query, body })
      return answers.post ?? { status: 200, ok: true, body: { ok: true } }
    },
  }
  return { hub, calls }
}

const context = (answers: {
  get?: HubAnswer
  post?: HubAnswer
}): ToolContext & { calls: Call[] } => {
  const { hub, calls } = fakeHub(answers)
  return Object.assign({ hub }, { calls })
}

describe('tool registry', () => {
  it('declares one name per tool, distinct', () => {
    const names = tools.map(tool => tool.name)
    expect(names).toEqual(['hub_state', 'device_report', 'device_settings', 'device_command'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('marks the three reads read only and the write not', () => {
    for (const tool of tools) {
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean')
      expect(tool.annotations.readOnlyHint).toBe(tool.name !== 'device_command')
    }
    expect(toolByName('device_command')?.annotations.destructiveHint).toBe(true)
  })

  it('finds a tool by name and answers null otherwise', () => {
    expect(toolByName('device_report')?.title).toBe('Diagnose one speaker')
    expect(toolByName('device_reprot')).toBeNull()
  })
})

describe('hub_state', () => {
  it('reads the state and prints the payload as it came', async () => {
    const payload = { ts: 1, pollMs: 3000, devices: [{ name: 'Kitchen' }] }
    const ctx = context({ get: { status: 200, ok: true, body: payload } })
    const result = await tools[0].run({}, ctx)
    expect(ctx.calls).toEqual([{ method: 'GET', path: '/api/state', query: {}, body: null }])
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toEqual(payload)
  })
})

describe('device_report and device_settings', () => {
  it('passes the host through as the hub spells it', async () => {
    const ctx = context({ get: { status: 200, ok: true, body: { host: '192.168.1.10' } } })
    await toolByName('device_report')?.run({ host: '192.168.1.10' }, ctx)
    await toolByName('device_settings')?.run({ host: 'kitchen' }, ctx)
    expect(ctx.calls).toEqual([
      { method: 'GET', path: '/api/report', query: { host: '192.168.1.10' }, body: null },
      { method: 'GET', path: '/api/settings', query: { host: 'kitchen' }, body: null },
    ])
  })

  it('reports an unknown host as an error carrying the hub answer', async () => {
    const ctx = context({ get: { status: 404, ok: false, body: { error: 'unknown device' } } })
    const result = await toolByName('device_report')?.run({ host: 'nope' }, ctx)
    expect(result?.isError).toBe(true)
    expect(JSON.parse(result?.text ?? '{}')).toEqual({ status: 404, error: 'unknown device' })
  })
})

describe('device_command', () => {
  it('forwards the intent untouched and returns the device answer', async () => {
    const answer = { status: 200, ok: true, body: { ok: true, command: 'setPlayerCmd:vol:30' } }
    const ctx = context({ post: answer })
    const result = await toolByName('device_command')?.run(
      { host: 'kitchen', intent: { action: 'volume', level: 30 } },
      ctx
    )
    expect(ctx.calls).toEqual([
      {
        method: 'POST',
        path: '/api/command',
        query: { host: 'kitchen' },
        body: { action: 'volume', level: 30 },
      },
    ])
    expect(result?.isError).toBe(false)
    expect(JSON.parse(result?.text ?? '{}')).toEqual(answer.body)
  })

  it('keeps the hub refusal, which is the authority on an intent', async () => {
    const ctx = context({
      post: { status: 422, ok: false, body: { error: 'volume must be between 0 and 100' } },
    })
    const result = await toolByName('device_command')?.run(
      { host: 'kitchen', intent: { action: 'volume', level: 300 } },
      ctx
    )
    expect(result?.isError).toBe(true)
    expect(JSON.parse(result?.text ?? '{}').status).toBe(422)
  })

  it('refuses an argument the schema does not name', async () => {
    const tool = toolByName('device_command')
    if (tool === null) throw new Error('device_command is missing')
    // The handler re-validates: a client that filters unknown keys before
    // sending is a courtesy, not the guard.
    await expect(
      tool.run({ host: 'kitchen', intent: { action: 'play' }, retries: 3 }, context({}))
    ).rejects.toThrow(/Unrecognized key/)
    await expect(tool.run({ intent: { action: 'play' } }, context({}))).rejects.toThrow()
    await expect(tool.run({ host: 'kitchen', intent: {} }, context({}))).rejects.toThrow()
  })
})

describe('schema guards', () => {
  it('refuses an unknown top level key on a read', async () => {
    await expect(toolByName('hub_state')?.run({ verbose: true }, context({}))).rejects.toThrow()
    await expect(toolByName('device_report')?.run({ host: '' }, context({}))).rejects.toThrow()
  })
})
