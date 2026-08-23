#!/usr/bin/env node
// @env node
import { createServer } from 'node:http'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { HUD_APP_HTML } from './mcp/hud-app.js'
import { listLocalSessions, readHudStatus } from './mcp/session-service.js'

const RESOURCE_URI = 'ui://codex-hud/dashboard.html'
const SessionInput = { sessionId: z.string().min(1).max(128).optional() }

function resultFor(sessionId?: string) {
  const result = readHudStatus(sessionId)
  if (!result.snapshot) {
    const error = result.binding.reason ?? 'No local Codex session is available.'
    return {
      isError: true,
      content: [{ type: 'text' as const, text: error }],
      structuredContent: { snapshot: null, error },
    }
  }
  return {
    content: [{ type: 'text' as const, text: `Codex HUD is bound to session ${result.snapshot.session?.id ?? 'unknown'}.` }],
    structuredContent: { snapshot: result.snapshot, bindingSource: result.binding.source },
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'codex-hud', version: '0.1.0' })

  registerAppTool(server, 'codex_hud_open', {
    title: 'Open Codex HUD',
    description: 'Open a live HUD for the current local Codex session. Uses the current thread automatically when available.',
    inputSchema: SessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ['model'] } },
  }, async ({ sessionId }) => resultFor(sessionId))

  registerAppTool(server, 'codex_hud_refresh', {
    title: 'Refresh Codex HUD',
    description: 'Refresh the local Codex HUD snapshot for an already bound session.',
    inputSchema: SessionInput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { visibility: ['app'] } },
  }, async ({ sessionId }) => resultFor(sessionId))

  server.registerTool('codex_hud_list_sessions', {
    title: 'List local Codex sessions',
    description: 'List recent local root Codex sessions when automatic binding is unavailable.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => {
    const sessions = listLocalSessions().map(session => ({
      id: session.sessionId,
      cwd: session.cwd,
      updatedAt: new Date(session.mtimeMs).toISOString(),
    }))
    return {
      content: [{ type: 'text', text: JSON.stringify(sessions) }],
      structuredContent: { sessions },
    }
  })

  registerAppResource(server, 'Codex HUD', RESOURCE_URI, {
    mimeType: RESOURCE_MIME_TYPE,
    description: 'Live local Codex session HUD.',
  }, async () => ({
    contents: [{
      uri: RESOURCE_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: HUD_APP_HTML,
      _meta: { ui: { prefersBorder: true } },
    }],
  }))

  return server
}

export async function runMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport())
}

export async function runMcpHttpServer(): Promise<void> {
  const host = process.env.CODEX_HUD_MCP_HOST || '127.0.0.1'
  const port = Number(process.env.CODEX_HUD_MCP_PORT || 8787)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`Invalid CODEX_HUD_MCP_PORT: ${process.env.CODEX_HUD_MCP_PORT}`)

  const httpServer = createServer(async (request, response) => {
    if (request.url === '/healthz' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, service: 'codex-hud' }))
      return
    }
    if (request.url !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type, mcp-session-id, mcp-protocol-version, last-event-id')
    response.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const server = createMcpServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response)
    }
    catch (error) {
      console.error('Codex HUD MCP HTTP request failed:', error)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: 'Internal MCP server error' }))
      }
    }
    finally {
      await transport.close().catch(() => {})
      await server.close().catch(() => {})
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(port, host, () => resolve())
  })
  console.error(`Codex HUD MCP HTTP server listening on http://${host}:${port}/mcp`)

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      httpServer.close(() => resolve())
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = process.argv.includes('--http') ? runMcpHttpServer : runMcpServer
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
