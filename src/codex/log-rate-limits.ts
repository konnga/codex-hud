import type { RawRateLimits } from '../types/rollout.js'
import type { UsageData, UsageWindow } from '../types/state.js'
// @env node
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome, getHudStateDirectory } from '../config/paths.js'
import { setTimedCache } from '../runtime/timed-cache.js'
import { normalizeAccountRateLimits } from './rate-limits.js'
import { endpointOrigin, findCodexLogDatabase, isOfficialOpenAIEndpoint } from './session-endpoint.js'

export interface LoggedUsageSnapshot {
  usage: UsageData
  observedAt: Date
  origin: string
  source: 'log' | 'rollout-cache'
}

const EVENT_PREFIX = 'SSE event: '
const EVENT_TYPE_MARKER = 'codex.rate_limits'
const QUERY_TIMEOUT_MS = 750
const CACHE_MS = 15_000
const MAX_EVENT_AGE_SECONDS = 8 * 24 * 60 * 60
const RESETLESS_FRESHNESS_MS = 6 * 60 * 60 * 1_000
const MAX_ROW_LOOKBACK = 200_000
const MAX_EVENT_CANDIDATES = 1_000
const SNAPSHOT_FILE_NAME = 'account-usage.json'
const MAX_STORED_BODY_LENGTH = 16_384
const CACHE_MAX_AGE_MS = 30 * 60_000
const CACHE_MAX_ENTRIES = 64

const cache = new Map<string, { at: number, value: LoggedUsageSnapshot | null }>()

export interface LoggedRateLimitTarget {
  target: string
  count: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function decodeHex(value: string): string | null {
  if (!value || value.length % 2 !== 0 || !/^[\dA-F]+$/i.test(value)) {
    return null
  }
  try {
    return Buffer.from(value, 'hex').toString('utf8')
  }
  catch {
    return null
  }
}

function parseEvent(body: string): UsageData | null {
  const marker = body.indexOf(EVENT_PREFIX)
  if (marker < 0) {
    return null
  }
  try {
    const event = record(JSON.parse(body.slice(marker + EVENT_PREFIX.length)))
    const limits = record(event?.rate_limits)
    if (event?.type !== 'codex.rate_limits' || !limits) {
      return null
    }
    const raw: RawRateLimits = {
      ...limits,
      credits: record(event.credits),
      plan_type: typeof event.plan_type === 'string' ? event.plan_type : null,
      rate_limit_reached_type: limits.limit_reached === true ? 'rate_limit_reached' : null,
    }
    return normalizeAccountRateLimits(raw)
  }
  catch {
    return null
  }
}

function rawWindow(window: UsageWindow | null): Record<string, unknown> | null {
  return window
    ? {
        used_percent: window.percent,
        window_minutes: window.windowMinutes ?? null,
        resets_at: window.resetAt?.toISOString() ?? null,
      }
    : null
}

function rolloutSnapshotBody(usage: UsageData): string {
  return `${EVENT_PREFIX}${JSON.stringify({
    type: EVENT_TYPE_MARKER,
    plan_type: usage.planType,
    rate_limits: {
      limit_id: 'codex',
      limit_name: 'Codex',
      primary: rawWindow(usage.primary),
      secondary: rawWindow(usage.secondary),
      individual_limit: rawWindow(usage.individual),
      limit_reached: Boolean(usage.limitReachedType),
    },
    credits: usage.balanceLabel
      ? { has_credits: true, unlimited: false, balance: usage.balanceLabel }
      : null,
  })}`
}

function freshWindow(window: UsageWindow | null, observedAt: Date, now: number): UsageWindow | null {
  if (!window) {
    return null
  }
  if (window.resetAt) {
    return window.resetAt.getTime() > now ? window : null
  }
  return now - observedAt.getTime() <= RESETLESS_FRESHNESS_MS ? window : null
}

function freshUsage(usage: UsageData, observedAt: Date, now: number): UsageData | null {
  const primary = freshWindow(usage.primary, observedAt, now)
  const secondary = freshWindow(usage.secondary, observedAt, now)
  const individual = freshWindow(usage.individual, observedAt, now)
  if (!primary && !secondary && !individual && !usage.balanceLabel) {
    return null
  }
  return { ...usage, primary, secondary, individual }
}

function cloneSnapshot(value: LoggedUsageSnapshot | null): LoggedUsageSnapshot | null {
  return value ? structuredClone(value) : null
}

function storedSnapshotPath(env: NodeJS.ProcessEnv): string {
  return path.join(getHudStateDirectory(env), SNAPSHOT_FILE_NAME)
}

function readStoredSnapshot(
  env: NodeJS.ProcessEnv,
  now: number,
  expectedOrigin?: string,
): LoggedUsageSnapshot | null {
  try {
    const stored = record(JSON.parse(fs.readFileSync(storedSnapshotPath(env), 'utf8')))
    const entries = record(stored?.entries)
    if (stored?.version !== 2 || !entries) {
      return null
    }
    const candidates = expectedOrigin === undefined
      ? Object.entries(entries)
      : [[expectedOrigin, entries[expectedOrigin]] as const]
    let newest: LoggedUsageSnapshot | null = null
    for (const [origin, rawEntry] of candidates) {
      const entry = record(rawEntry)
      const observedAt = typeof entry?.observed_at === 'string' ? new Date(entry.observed_at) : null
      const body = typeof entry?.body === 'string' ? entry.body : null
      if (!observedAt || Number.isNaN(observedAt.getTime()) || !body || body.length > MAX_STORED_BODY_LENGTH
        || now - observedAt.getTime() > MAX_EVENT_AGE_SECONDS * 1_000) {
        continue
      }
      const usage = parseEvent(body)
      const fresh = usage ? freshUsage(usage, observedAt, now) : null
      if (fresh && (!newest || observedAt > newest.observedAt)) {
        newest = {
          usage: fresh,
          observedAt,
          origin,
          source: entry?.source === 'rollout-cache' ? 'rollout-cache' : 'log',
        }
      }
    }
    return newest
  }
  catch {
    return null
  }
}

function writeStoredSnapshot(
  env: NodeJS.ProcessEnv,
  body: string,
  observedAt: Date,
  origin: string,
  source: LoggedUsageSnapshot['source'],
): void {
  if (body.length > MAX_STORED_BODY_LENGTH) {
    return
  }
  const filePath = storedSnapshotPath(env)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    let stored: Record<string, unknown> | null = null
    try {
      stored = record(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    }
    catch {
      // A missing or legacy cache starts a new provider-partitioned snapshot.
    }
    const currentEntries = stored?.version === 2 ? record(stored.entries) : null
    const entries = currentEntries ? { ...currentEntries } : {}
    const current = record(entries[origin])
    const currentObservedAt = typeof current?.observed_at === 'string' ? new Date(current.observed_at) : null
    if (currentObservedAt && !Number.isNaN(currentObservedAt.getTime()) && currentObservedAt >= observedAt) {
      return
    }
    entries[origin] = { observed_at: observedAt.toISOString(), source, body }
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporaryPath, `${JSON.stringify({
      version: 2,
      entries,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporaryPath, filePath)
    fs.chmodSync(filePath, 0o600)
  }
  catch {
    try {
      fs.rmSync(temporaryPath, { force: true })
    }
    catch {
      // The account snapshot is optional and must never break the HUD.
    }
  }
}

/**
 * Share an account-wide rollout observation with sibling HUD sessions. Recent
 * Codex builds can emit limits only into rollout JSONL, while a concurrent
 * model-specific session has no account quota of its own to display.
 */
export function persistRolloutRateLimits(
  usage: UsageData | null,
  observedAt: Date | null,
  endpoint: string | null,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!usage || !observedAt || Number.isNaN(observedAt.getTime()) || !endpoint || !isOfficialOpenAIEndpoint(endpoint)) {
    return
  }
  const origin = endpointOrigin(endpoint)
  if (!origin) {
    return
  }
  writeStoredSnapshot(env, rolloutSnapshotBody(usage), observedAt, origin, 'rollout-cache')
}

function eventOrigin(database: string, processUuid: string, timestamp: number): string | null {
  const safeProcessUuid = processUuid.replaceAll('\'', '\'\'')
  const sql = [
    'SELECT feedback_log_body',
    '  FROM logs',
    ` WHERE process_uuid = '${safeProcessUuid}'`,
    `   AND ts BETWEEN ${timestamp - MAX_EVENT_AGE_SECONDS} AND ${timestamp + 60}`,
    `   AND target IN ('codex_http_client::default_client', 'codex_http_client::client')`,
    `   AND instr(feedback_log_body, 'url=') > 0`,
    ` ORDER BY abs(ts - ${timestamp}) ASC, id DESC`,
    ' LIMIT 1;',
  ].join('\n')
  const result = spawnSync('sqlite3', ['-readonly', '-noheader', '-batch', database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  const match = typeof result.stdout === 'string' ? /\burl=(https?:\/\/[^\s"]+)/.exec(result.stdout) : null
  return match ? endpointOrigin(match[1]) : null
}

/**
 * Codex currently logs `codex.rate_limits` SSE events but does not copy them
 * into rollout token-count events for every provider. Keep the newest
 * account-wide event per provider origin and share it with other open HUD
 * processes. `expectedEndpoint` names the provider the caller is bound to; passing
 * null means the endpoint is unknown, and showing no usage beats showing
 * another provider's account.
 */
export function readLatestLoggedRateLimits(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  expectedEndpoint?: string | null,
): LoggedUsageSnapshot | null {
  const expectedOrigin = expectedEndpoint === undefined ? undefined : expectedEndpoint ? endpointOrigin(expectedEndpoint) : null
  if (expectedOrigin === null) {
    return null
  }
  const codexHome = getCodexHome(env)
  const cacheKey = `${codexHome}:${expectedOrigin ?? '*'}`
  const cached = cache.get(cacheKey)
  if (cached && now - cached.at < CACHE_MS) {
    return cloneSnapshot(cached.value)
  }
  const remember = (value: LoggedUsageSnapshot | null): LoggedUsageSnapshot | null => {
    setTimedCache(cache, cacheKey, { at: now, value: cloneSnapshot(value) }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
    return cloneSnapshot(value)
  }
  let previous = readStoredSnapshot(env, now, expectedOrigin)
  if (cached?.value) {
    const fallback = freshUsage(cached.value.usage, cached.value.observedAt, now)
    if (fallback) {
      const cachedSnapshot: LoggedUsageSnapshot = {
        usage: fallback,
        observedAt: cached.value.observedAt,
        origin: cached.value.origin,
        source: cached.value.source,
      }
      if (!previous || cachedSnapshot.observedAt > previous.observedAt) {
        previous = cachedSnapshot
      }
    }
  }
  const database = findCodexLogDatabase(codexHome)
  if (!database) {
    return remember(previous)
  }
  const since = Math.floor(now / 1_000) - MAX_EVENT_AGE_SECONDS
  const sql = [
    `SELECT ts || '|' || hex(process_uuid) || '|' || hex(substr(feedback_log_body, 1, ${MAX_STORED_BODY_LENGTH}))`,
    '  FROM logs',
    ` WHERE id >= (SELECT max(id) - ${MAX_ROW_LOOKBACK} FROM logs)`,
    `   AND ts >= ${since}`,
    `   AND instr(feedback_log_body, '${EVENT_PREFIX}') > 0`,
    `   AND instr(feedback_log_body, '${EVENT_TYPE_MARKER}') > 0`,
    ' ORDER BY ts DESC, id DESC',
    ` LIMIT ${MAX_EVENT_CANDIDATES};`,
  ].join('\n')
  const result = spawnSync('sqlite3', ['-readonly', '-noheader', '-batch', database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  if (typeof result.stdout !== 'string') {
    return remember(previous)
  }
  const origins = new Map<string, string | null>()
  for (const line of result.stdout.split('\n')) {
    const [timestampValue, processValue, bodyValue] = line.split('|')
    const timestamp = Number(timestampValue)
    const processUuid = decodeHex(processValue ?? '')
    const body = decodeHex(bodyValue ?? '')
    if (!Number.isFinite(timestamp) || !processUuid || !body) {
      continue
    }
    const observedAt = new Date(timestamp * 1_000)
    const usage = parseEvent(body)
    const fresh = usage ? freshUsage(usage, observedAt, now) : null
    if (!fresh) {
      // Attributing an event costs one sqlite3 spawn per process, so stale
      // events must be dropped before their origin is ever looked up.
      continue
    }
    const origin = origins.has(processUuid)
      ? origins.get(processUuid) ?? null
      : eventOrigin(database, processUuid, timestamp)
    origins.set(processUuid, origin)
    if (!origin || (expectedOrigin !== undefined && origin !== expectedOrigin)) {
      continue
    }
    if (previous && previous.observedAt >= observedAt) {
      return remember(previous)
    }
    writeStoredSnapshot(env, body, observedAt, origin, 'log')
    return remember({ usage: fresh, observedAt, origin, source: 'log' })
  }
  return remember(previous)
}

export function inspectLoggedRateLimitTargets(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): LoggedRateLimitTarget[] {
  const database = findCodexLogDatabase(getCodexHome(env))
  if (!database) {
    return []
  }
  const since = Math.floor(now / 1_000) - MAX_EVENT_AGE_SECONDS
  const sql = [
    `SELECT hex(target) || '|' || hex(substr(feedback_log_body, 1, ${MAX_STORED_BODY_LENGTH}))`,
    '  FROM logs',
    ` WHERE id >= (SELECT max(id) - ${MAX_ROW_LOOKBACK} FROM logs)`,
    `   AND ts >= ${since}`,
    `   AND instr(feedback_log_body, '${EVENT_PREFIX}') > 0`,
    `   AND instr(feedback_log_body, '${EVENT_TYPE_MARKER}') > 0`,
    ' ORDER BY id DESC',
    ` LIMIT ${MAX_EVENT_CANDIDATES};`,
  ].join('\n')
  const result = spawnSync('sqlite3', ['-readonly', '-noheader', '-batch', database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  if (typeof result.stdout !== 'string') {
    return []
  }
  const counts = new Map<string, number>()
  for (const line of result.stdout.split('\n')) {
    const [targetValue, bodyValue] = line.split('|')
    const target = decodeHex(targetValue ?? '')
    const body = decodeHex(bodyValue ?? '')
    if (target && body && parseEvent(body)) {
      counts.set(target, (counts.get(target) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([target, count]) => ({ target, count }))
    .sort((left, right) => right.count - left.count || left.target.localeCompare(right.target))
}
