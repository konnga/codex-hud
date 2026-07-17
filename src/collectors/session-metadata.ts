import type { AuthInfo, SessionInfo } from '../types/state.js'
// @env node
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome } from '../config/paths.js'

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

export function collectAuthInfo(planType: string | null, env: NodeJS.ProcessEnv = process.env): AuthInfo | null {
  const cacheKey = `${getCodexHome(env)}:${planType ?? ''}:${Boolean(env.OPENAI_API_KEY)}`
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
    const value = { method: 'API Key' }
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
