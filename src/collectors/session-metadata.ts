import type { AuthInfo, SessionInfo } from '../types/state.js'
// @env node
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'smol-toml'
import { resolveProcessEndpoint, resolveSessionEndpoint } from '../codex/session-endpoint.js'
import { getCodexHome } from '../config/paths.js'

/** The Codex process a HUD pane was launched for, before it has a session. */
export interface CodexProcess {
  pid: number
  launchedAt: Date
}

type UnknownRecord = Record<string, unknown>
const titleCache = new Map<string, { at: number, title: string | null }>()
const authCache = new Map<string, { at: number, value: AuthInfo | null }>()
const METADATA_CACHE_MS = 30_000

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function decodeJwt(value: string): UnknownRecord | null {
  const payload = value.split('.')[1]
  if (!payload) {
    return null
  }
  try {
    return record(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
  }
  catch {
    return null
  }
}

function findString(value: unknown, keys: Set<string>, depth = 0): string | null {
  if (depth > 5) {
    return null
  }
  const item = record(value)
  if (!item) {
    return null
  }
  for (const [key, child] of Object.entries(item)) {
    if (keys.has(key.toLowerCase()) && typeof child === 'string' && child.trim()) {
      return child.trim()
    }
  }
  for (const child of Object.values(item)) {
    const found = findString(child, keys, depth + 1)
    if (found) {
      return found
    }
  }
  return null
}

function jwtUser(value: unknown, depth = 0): string | null {
  if (depth > 5) {
    return null
  }
  if (typeof value === 'string') {
    const claims = decodeJwt(value)
    const email = findString(claims, new Set(['email', 'preferred_username', 'name']))
    return email ? email.split('@')[0] : null
  }
  const item = record(value)
  if (!item) {
    return null
  }
  for (const child of Object.values(item)) {
    const found = jwtUser(child, depth + 1)
    if (found) {
      return found
    }
  }
  return null
}

const GENERIC_SUFFIX = /^(?:com|co|net|org|edu|gov|ac|or|ne|gob|mil|int)$/

function providerLabel(baseUrl: string): string | null {
  let hostname: string
  try {
    hostname = new URL(baseUrl).hostname
  }
  catch {
    return null
  }
  const bare = hostname.replace(/^www\./, '').replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!bare) {
    return null
  }
  // Address literals carry no readable name; show them as they are.
  if (/^[\d.]+$/.test(bare) || bare.includes(':')) {
    return bare
  }
  // "https://anyrouter.top/v1" -> "anyrouter", "https://api.openai.com/v1" -> "openai".
  const labels = bare.split('.')
  const index = labels.length - 2
  if (index < 0) {
    return bare
  }
  // Skip the second level of a two-part suffix so "api.acme.com.cn" does not
  // collapse to "com".
  return index > 0 && GENERIC_SUFFIX.test(labels[index]) ? labels[index - 1] : labels[index]
}

/**
 * The endpoint declared in config.toml is only evidence about a session if the
 * file has not been rewritten since Codex read it at session start. Before a
 * session is bound the HUD has nothing to attribute the file to, so it must not
 * borrow the label: that window is exactly Codex's startup, when a provider the
 * user just switched away from is still the newest thing on disk.
 */
function configuredBaseUrl(session: SessionInfo, env: NodeJS.ProcessEnv): string | null {
  try {
    const configPath = path.join(getCodexHome(env), 'config.toml')
    if (fs.statSync(configPath).mtimeMs > session.startTime.getTime()) {
      return null
    }
    const config = record(parse(fs.readFileSync(configPath, 'utf8')))
    const providerName = session?.modelProvider
      ?? (typeof config?.model_provider === 'string' ? config.model_provider : null)
    if (!providerName) {
      return null
    }
    const provider = record(record(config?.model_providers)?.[providerName])
    return typeof provider?.base_url === 'string' ? provider.base_url : null
  }
  catch {
    return null
  }
}

export function collectAuthInfo(
  planType: string | null,
  session: SessionInfo | null = null,
  env: NodeJS.ProcessEnv = process.env,
  codexProcess: CodexProcess | null = null,
): AuthInfo | null {
  const cacheKey = `${getCodexHome(env)}:${planType ?? ''}:${session?.id ?? codexProcess?.pid ?? ''}:${Boolean(env.OPENAI_API_KEY)}`
  const cached = authCache.get(cacheKey)
  if (cached && Date.now() - cached.at < METADATA_CACHE_MS) {
    return cached.value ? structuredClone(cached.value) : null
  }
  const authPath = path.join(getCodexHome(env), 'auth.json')
  let auth: UnknownRecord = {}
  try {
    auth = record(JSON.parse(fs.readFileSync(authPath, 'utf8'))) ?? {}
  }
  catch {
    // Environment-only authentication is still detectable below.
  }
  const hasApiKey = typeof auth.OPENAI_API_KEY === 'string' || Boolean(env.OPENAI_API_KEY)
  const user = jwtUser(auth) ?? findString(auth, new Set(['email', 'preferred_username', 'username']))?.split('@')[0]
  if (planType) {
    const value = { method: `ChatGPT ${planType}`, user: user ?? undefined }
    authCache.set(cacheKey, { at: Date.now(), value })
    return structuredClone(value)
  }
  if (hasApiKey) {
    // Prefer the endpoint this session actually reached, because config.toml
    // may have been rewritten since the session started. When neither source
    // can prove an endpoint, stay generic rather than name the wrong host.
    const endpoint = session
      ? resolveSessionEndpoint(session.id, env)
      : codexProcess && resolveProcessEndpoint(codexProcess.pid, codexProcess.launchedAt, env)
    const baseUrl = session ? endpoint?.url ?? configuredBaseUrl(session, env) : endpoint?.url ?? null
    const value: AuthInfo = { method: (baseUrl ? providerLabel(baseUrl) : null) || 'API Key' }
    authCache.set(cacheKey, { at: Date.now(), value })
    return value
  }
  if (Object.keys(auth).length > 0) {
    const value = { method: 'ChatGPT', user: user ?? undefined }
    authCache.set(cacheKey, { at: Date.now(), value })
    return structuredClone(value)
  }
  authCache.set(cacheKey, { at: Date.now(), value: null })
  return null
}

export function collectSessionTitle(session: SessionInfo | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!session) {
    return null
  }
  const cacheKey = `${getCodexHome(env)}:${session.id}`
  const cached = titleCache.get(cacheKey)
  if (cached && Date.now() - cached.at < METADATA_CACHE_MS) {
    return cached.title
  }
  const database = path.join(getCodexHome(env), 'state_5.sqlite')
  if (!fs.existsSync(database)) {
    titleCache.set(cacheKey, { at: Date.now(), title: null })
    return null
  }
  const id = session.id.replaceAll('\'', '\'\'')
  const result = spawnSync('sqlite3', [database, '-noheader', '-batch', `SELECT CASE WHEN title <> first_user_message THEN title ELSE '' END FROM threads WHERE id='${id}' LIMIT 1;`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 750,
  })
  if (result.status !== 0) {
    titleCache.set(cacheKey, { at: Date.now(), title: null })
    return null
  }
  const title = result.stdout.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  const normalized = title ? title.slice(0, 80) : null
  titleCache.set(cacheKey, { at: Date.now(), title: normalized })
  return normalized
}
