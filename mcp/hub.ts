// The MCP server is a client of the hub's HTTP API and nothing more: it keeps
// no state of its own, and every answer it gives is one the hub already gives
// to a browser. That is what keeps `server/` free of an MCP dependency, and
// what makes the tools testable without a speaker on the desk.

export type HubAnswer = {
  // 0 when the request never reached the hub: refused, timed out, bad URL.
  status: number
  ok: boolean
  // The hub's JSON body, or `{ error }` when the wire said something else
  // (a proxy login page, an empty answer).
  body: unknown
}

export type Query = Record<string, string>

export type HubClient = {
  baseUrl: string
  get: (path: string, query?: Query) => Promise<HubAnswer>
  post: (path: string, query: Query, body: unknown) => Promise<HubAnswer>
}

type Send = (url: string, init: RequestInit) => Promise<Response>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A hub that is down, a proxy that answers HTML, a body that is not JSON: the
// tool layer has to say something useful in all three cases, so the failure is
// an answer like any other. A thrown error here would end as "MCP error -32603"
// in the client, which tells a user nothing.
const readAnswer = async (response: Response): Promise<HubAnswer> => {
  const text = await response.text()
  if (text.trim() === '') return { status: response.status, ok: response.ok, body: null }
  try {
    return { status: response.status, ok: response.ok, body: JSON.parse(text) }
  } catch {
    // Trimmed: a proxy error page is a wall of HTML, and the status already
    // carries the meaning.
    return { status: response.status, ok: response.ok, body: { error: text.trim().slice(0, 300) } }
  }
}

const reasonFor = (error: unknown): string => {
  if (error instanceof Error) {
    // AbortSignal.timeout rejects with a DOMException named TimeoutError.
    return error.name === 'TimeoutError' ? 'timed out' : error.message
  }
  return String(error)
}

export const createHub = ({
  baseUrl,
  token = '',
  timeoutMs = 20_000,
  send = fetch,
}: {
  baseUrl: string
  token?: string
  timeoutMs?: number
  send?: Send
}): HubClient => {
  // A trailing run of slashes is stripped by hand: the expression backtracked on
  // a long one (Sonar S8786).
  const trimmed = baseUrl.trim()
  let end = trimmed.length
  while (end > 0 && trimmed[end - 1] === '/') end -= 1
  const base = trimmed.slice(0, end)
  if (/^https?:\/\//.test(base) === false) {
    throw new Error(`WIIM_HUB_URL must start with http:// or https:// (got ${baseUrl})`)
  }
  const call = async (
    path: string,
    query: Query,
    init: { method: string; body?: string }
  ): Promise<HubAnswer> => {
    const url = new URL(`${base}${path}`)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const headers: Record<string, string> = { accept: 'application/json' }
    // The hub has no authentication of its own: this header is for the ingress
    // in front of it, when its policy accepts a bearer token.
    if (token !== '') headers.authorization = `Bearer ${token}`
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    try {
      const response = await send(url.toString(), {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      return await readAnswer(response)
    } catch (error) {
      return {
        status: 0,
        ok: false,
        body: { error: `hub unreachable at ${base}: ${reasonFor(error)}` },
      }
    }
  }
  return {
    baseUrl: base,
    get: (path, query = {}) => call(path, query, { method: 'GET' }),
    post: (path, query, body) => call(path, query, { method: 'POST', body: JSON.stringify(body) }),
  }
}

// The tools answer errors in the shape the hub uses, so a caller that already
// knows `{ error }` from the API docs reads the same thing: the status is kept
// and the body passed through, never paraphrased.
export const errorText = (entry: HubAnswer): string =>
  JSON.stringify(
    { status: entry.status, ...(isRecord(entry.body) ? entry.body : { body: entry.body }) },
    null,
    2
  )

export const okText = (entry: HubAnswer): string => JSON.stringify(entry.body, null, 2)
