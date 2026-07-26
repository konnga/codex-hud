// @env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome } from '../config/paths.js'

/**
 * Where an endpoint came from. `log-request` is a URL Codex actually posted to;
 * `log-init` is the provider Codex resolved when the session started, looked up
 * by session or, before a session exists, by the Codex process itself.
 */
export type EndpointSource = 'log-request' | 'log-init'

export interface SessionEndpoint {
  url: string
  source: EndpointSource
}

const SESSION_ID_PATTERN = /^[\w-]{1,128}$/
const LOG_DATABASE_PATTERN = /^logs(?:_(\d+))?\.sqlite$/
const QUERY_TIMEOUT_MS = 750
const ENDPOINT_CACHE_MS = 30_000
// `ts` stores whole seconds, so several rows routinely share one value; the
// rowid tiebreak keeps "newest" meaning insertion order rather than scan order.
const NEWEST_FIRST = 'ORDER BY ts DESC, id DESC LIMIT 1'

const endpointCache = new Map<string, { at: number, value: SessionEndpoint | null }>()

/**
 * Codex writes its tracing log to `logs_<schema>.sqlite`; pick the newest
 * schema so a Codex upgrade that bumps the suffix keeps working.
 */
export function findCodexLogDatabase(codexHome: string = getCodexHome()): string | null {
  let best: { file: string, version: number } | null = null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(codexHome, { withFileTypes: true })
  }
  catch {
    return null
  }
  for (const entry of entries) {
    const match = LOG_DATABASE_PATTERN.exec(entry.name)
    if (!match || !entry.isFile()) {
      continue
    }
    const version = Number(match[1] ?? 0)
    if (!best || version > best.version) {
      best = { file: path.join(codexHome, entry.name), version }
    }
  }
  return best?.file ?? null
}

function query(database: string, sql: string): string[] {
  const result = spawnSync('sqlite3', ['-readonly', '-noheader', '-batch', database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  // sqlite3 aborts on the first failing statement but keeps whatever earlier
  // ones already printed, so a broken fallback query must not discard a good
  // answer from the query before it.
  return typeof result.stdout === 'string' ? result.stdout.split('\n') : []
}

function firstUrl(value: string): string | null {
  const url = value.trim().split(/[\s"]/)[0]
  return url.startsWith('http') ? url : null
}

const INIT_ROW = [
  `SELECT 'init|' || substr(feedback_log_body, instr(feedback_log_body, 'base_url: Some("') + 16, 200)`,
  `  FROM logs`,
  ` WHERE thread_id IS NULL`,
  `   AND target = 'codex_core::session::session'`,
  `   AND instr(feedback_log_body, 'base_url: Some("') > 0`,
].join('\n')

/** `process_uuid` is `pid:<PID>:<uuid>`, so a PID is a prefix range on it. */
function processRange(pid: number): string {
  return `(process_uuid >= 'pid:${pid}:' AND process_uuid < 'pid:${pid};')`
}

/**
 * Codex runs behind an npm wrapper script, so the process that logs is a child
 * of the one the launcher spawned.
 */
function processFamily(pid: number): number[] {
  const result = spawnSync('pgrep', ['-P', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  const children = typeof result.stdout === 'string'
    ? result.stdout.split('\n').map(line => Number.parseInt(line.trim(), 10)).filter(Number.isInteger)
    : []
  return [pid, ...children]
}

/**
 * The endpoint of a Codex process that has not created a session yet. Codex
 * writes no rollout until the first message, so between launch and that message
 * the process is the only thing the HUD can key on.
 *
 * `since` bounds the scan to this launch: the timestamp column is the indexed
 * one, and without a bound the lookup walks every threadless row ever logged.
 */
export function resolveProcessEndpoint(
  codexPid: number,
  since: Date,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): SessionEndpoint | null {
  if (!Number.isInteger(codexPid) || codexPid <= 0) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:pid:${codexPid}`
  const cached = endpointCache.get(cacheKey)
  if (cached && now - cached.at < ENDPOINT_CACHE_MS) {
    return cached.value ? { ...cached.value } : null
  }
  const database = findCodexLogDatabase(codexHome)
  const ranges = database ? processFamily(codexPid).map(processRange).join(' OR ') : ''
  const lines = ranges
    ? query(database as string, [
        INIT_ROW,
        `   AND ts >= ${Math.floor(since.getTime() / 1_000) - 60}`,
        `   AND (${ranges})`,
        ` ${NEWEST_FIRST};`,
      ].join('\n'))
    : []
  let value: SessionEndpoint | null = null
  for (const line of lines) {
    const url = line.startsWith('init|') ? firstUrl(line.slice(5)) : null
    if (url) {
      value = { url, source: 'log-init' }
      break
    }
  }
  sweep(now)
  endpointCache.set(cacheKey, { at: now, value })
  return value ? { ...value } : null
}

function sweep(now: number): void {
  for (const [key, entry] of endpointCache) {
    if (now - entry.at >= ENDPOINT_CACHE_MS) {
      endpointCache.delete(key)
    }
  }
}

/**
 * The session id doubles as the tracing `thread_id`, so Codex's own log is the
 * only record of which endpoint a session really used: `config.toml` may have
 * been rewritten since, and the rollout stores just the provider id.
 *
 * Both queries are index-backed. `AND thread_id IS NULL` on the second one is
 * load-bearing for speed, not only correctness: without it the lookup degrades
 * to a full scan of a multi-hundred-megabyte table on the render path.
 */
export function resolveSessionEndpoint(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): SessionEndpoint | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:${sessionId}`
  const cached = endpointCache.get(cacheKey)
  if (cached && now - cached.at < ENDPOINT_CACHE_MS) {
    return cached.value ? { ...cached.value } : null
  }
  const remember = (value: SessionEndpoint | null): SessionEndpoint | null => {
    sweep(now)
    endpointCache.set(cacheKey, { at: now, value })
    return value ? { ...value } : null
  }
  const database = findCodexLogDatabase(codexHome)
  if (!database) {
    return remember(null)
  }
  const lines = query(database, [
    `SELECT 'request|' || substr(feedback_log_body, instr(feedback_log_body, 'url=') + 4, 200)`,
    `  FROM logs`,
    ` WHERE thread_id = '${sessionId}'`,
    `   AND target = 'codex_http_client::default_client'`,
    `   AND instr(feedback_log_body, 'url=') > 0`,
    ` ${NEWEST_FIRST};`,
    // One Codex process can host several sessions in turn, each writing its own
    // threadless init row, so bound the fallback to this thread's own lifetime.
    INIT_ROW,
    `   AND process_uuid = (SELECT process_uuid FROM logs WHERE thread_id = '${sessionId}' ${NEWEST_FIRST})`,
    `   AND ts <= (SELECT min(ts) FROM logs WHERE thread_id = '${sessionId}')`,
    ` ${NEWEST_FIRST};`,
  ].join('\n'))
  let fallback: SessionEndpoint | null = null
  for (const line of lines) {
    const separator = line.indexOf('|')
    if (separator < 0) {
      continue
    }
    const tag = line.slice(0, separator)
    const url = firstUrl(line.slice(separator + 1))
    if (!url) {
      continue
    }
    if (tag === 'request') {
      return remember({ url, source: 'log-request' })
    }
    if (tag === 'init' && !fallback) {
      fallback = { url, source: 'log-init' }
    }
  }
  return remember(fallback)
}
