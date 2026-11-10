import { z } from 'zod'
import { errorText, type HubAnswer, type HubClient, okText } from './hub.ts'

// One descriptor per tool, with no MCP type in sight: the transport registers
// these, and the tests call them directly. A tool that needs the protocol to be
// exercised is a tool nobody tests.

export type ToolResult = { text: string; isError: boolean }

export type ToolContext = { hub: HubClient }

// What a client shows before a call: three of these only read, and the write
// changes the player's state on the other side.
export type ToolAnnotations = {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export type Tool = {
  name: string
  title: string
  description: string
  input: z.ZodType
  annotations: ToolAnnotations
  run: (raw: unknown, context: ToolContext) => Promise<ToolResult>
}

const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const answer = (entry: HubAnswer): ToolResult =>
  entry.ok ? { text: okText(entry), isError: false } : { text: errorText(entry), isError: true }

const hostField = z
  .string()
  .min(1)
  .describe(
    'The speaker as the hub knows it: the name it reports, the address it is configured with, or the address it currently answers on. A name two speakers share is refused, so use the address then.'
  )

const hubStateInput = z.object({}).strict()
const deviceReportInput = z.object({ host: hostField }).strict()
const deviceSettingsInput = z.object({ host: hostField }).strict()
const deviceCommandInput = z
  .object({
    host: hostField,
    intent: z
      .looseObject({ action: z.string().min(1) })
      .describe(
        'The intent, passed to the hub unchanged: `{"action":"volume","level":30}`, `{"action":"seek","seconds":42}`, `{"action":"play"}`. The hub validates it and its answer is the authority on what is accepted.'
      ),
  })
  .strict()

export const tools: readonly Tool[] = [
  {
    name: 'hub_state',
    title: 'Read the whole fleet',
    description:
      'Read the hub state: one entry per managed speaker with what the last poll saw (name, address, model, firmware, playback, volume, link, group), plus the findings and the guided checks derived from it. Same payload the page polls, so it is the cheapest way to see everything at once. A finding carries its own evidence lines.',
    input: hubStateInput,
    annotations: readOnly,
    run: async (raw, { hub }) => {
      hubStateInput.parse(raw)
      return answer(await hub.get('/api/state'))
    },
  },
  {
    name: 'device_report',
    title: 'Diagnose one speaker',
    description:
      'Read the diagnostic report of one speaker: the findings with the raw answers behind them, the guided checks, the inventory of the probed commands, how its name resolved, and a `markdown` rendering meant to be pasted into a support thread. It probes the player, so it takes a few seconds when the player answers; an offline player is reported without probing.',
    input: deviceReportInput,
    annotations: readOnly,
    run: async (raw, { hub }) => {
      const { host } = deviceReportInput.parse(raw)
      return answer(await hub.get('/api/report', { host }))
    },
  },
  {
    name: 'device_settings',
    title: 'Read one speaker settings',
    description:
      'Read the settings sheet of one speaker: name, LED and front buttons, balance, maximum volume, fade. Read when the sheet opens rather than polled, so it costs four commands; an offline player answers 409.',
    input: deviceSettingsInput,
    annotations: readOnly,
    run: async (raw, { hub }) => {
      const { host } = deviceSettingsInput.parse(raw)
      return answer(await hub.get('/api/settings', { host }))
    },
  },
  {
    name: 'device_command',
    title: 'Send one intent to a speaker',
    description:
      'Send one intent to one speaker and return the device own answer (`{ok, unsupported, command, body}`). The hub validates the intent and the value range: an unknown action, a missing field or an out of range value comes back with its 400 or 422 answer, which is the authority on what is accepted. Intents: play, pause, toggle, stop, next, prev, seek {seconds}, volume {level}, mute {muted}, source {input}, preset {slot}, sleep {seconds}, output {hardware}, eq {enabled}, eqPreset {name}, eqBand {band, value}, rename {name}, led {on}, buttons {on}, balance {value}, maxVolume {level}, fade {on}, url {url}. Writes are queued per device and confirmed by a poll a few hundred milliseconds later: the answer is the player reply, not the new state.',
    input: deviceCommandInput,
    annotations: {
      readOnlyHint: false,
      // A rename, a source change or a URL playback have an effect the user
      // cannot undo by repeating the call.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    run: async (raw, { hub }) => {
      const { host, intent } = deviceCommandInput.parse(raw)
      return answer(await hub.post('/api/command', { host }, intent))
    },
  },
]

export const toolByName = (name: string): Tool | null =>
  tools.find(tool => tool.name === name) ?? null
