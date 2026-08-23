#!/usr/bin/env node
// @env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
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
    contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: HUD_APP_HTML }],
  }))

  return server
}

export async function runMcpServer(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport())
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMcpServer().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
