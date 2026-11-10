import { readFile } from 'node:fs/promises'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createHub, type HubClient } from './hub.ts'
import { tools } from './tools.ts'

// This process speaks MCP on stdout, so nothing else may: one stray console.log
// and the client reads a JSON-RPC frame that is not one. Every message goes to
// stderr, which the client shows as the server's log.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const packageVersion = async (): Promise<string> => {
  try {
    const raw: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    )
    return isRecord(raw) && typeof raw.version === 'string' ? raw.version : 'dev'
  } catch {
    // The bundle is not always beside a package.json; the protocol works with
    // any version string, and a crash here would hide the real problem.
    return 'dev'
  }
}

const hubUrl = (process.env.WIIM_HUB_URL ?? '').trim()

const main = async (): Promise<void> => {
  if (hubUrl === '') {
    console.error(
      'wiim-hub mcp: WIIM_HUB_URL is empty. Point it at the hub, for example\n' +
        '  WIIM_HUB_URL=http://192.168.1.10:8090'
    )
    process.exit(1)
  }
  let hub: HubClient
  try {
    hub = createHub({
      baseUrl: hubUrl,
      token: (process.env.WIIM_HUB_TOKEN ?? '').trim(),
    })
  } catch (error) {
    // A wrong URL is a configuration mistake. A stack trace here would bury the
    // one line that says what to fix, and the client shows stderr as is.
    console.error(`wiim-hub mcp: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  const server = new McpServer({ name: 'wiim-hub', version: await packageVersion() })
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.annotations,
      },
      async args => {
        const result = await tool.run(args, { hub })
        return { content: [{ type: 'text', text: result.text }], isError: result.isError }
      }
    )
  }
  await server.connect(new StdioServerTransport())
  console.error(`wiim-hub mcp: ${tools.length} tools, hub at ${hub.baseUrl}`)
}

await main()
