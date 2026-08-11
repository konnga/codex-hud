import type { RawRateLimits } from '../types/rollout.js'
import type { UsageData, UsageWindow } from '../types/state.js'
// @env node
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome, getHudStateDirectory } from '../config/paths.js'
import { normalizeRateLimits } from './rate-limits.js'
import { findCodexLogDatabase } from './session-endpoint.js'

export interface LoggedUsageSnapshot {
  usage: UsageData
  observedAt: Date
}

const EVENT_PREFIX = 'SSE event: '
const QUERY_TIMEOUT_MS = 750
const CACHE_MS = 15_000
const MAX_EVENT_AGE_SECONDS = 8 * 24 * 60 * 60
const RESETLESS_FRESHNESS_MS = 6 * 60 * 60 * 1_000
const MAX_ROW_LOOKBACK = 200_000
const SNAPSHOT_FILE_NAME = 'account-usage.json'
const MAX_STORED_BODY_LENGTH = 16_384

const cache = new Map<string, { at: number, value: LoggedUsageSnapshot | null }>()

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
    return normalizeRateLimits(raw)
  }
  catch {
    return null
  }
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

function readStoredSnapshot(env: NodeJS.ProcessEnv, now: number): LoggedUsageSnapshot | null {
  try {
    const stored = record(JSON.parse(fs.readFileSync(storedSnapshotPath(env), 'utf8')))
    if (stored?.version !== 1 || typeof stored.body !== 'string' || stored.body.length > MAX_STORED_BODY_LENGTH) {
      return null
    }
    const observedAt = typeof stored.observed_at === 'string' ? new Date(stored.observed_at) : null
    if (!observedAt || Number.isNaN(observedAt.getTime()) || now - observedAt.getTime() > MAX_EVENT_AGE_SECONDS * 1_000) {
      return null
    }
    const usage = parseEvent(stored.body)
    const fresh = usage ? freshUsage(usage, observedAt, now) : null
    return fresh ? { usage: fresh, observedAt } : null
  }
  catch {
    return null
  }
}

function writeStoredSnapshot(env: NodeJS.ProcessEnv, body: string, observedAt: Date, now: number): void {
  if (body.length > MAX_STORED_BODY_LENGTH) {
    return
  }
  const existing = readStoredSnapshot(env, now)
  if (existing && existing.observedAt.getTime() > observedAt.getTime()) {
    return
  }
  const filePath = storedSnapshotPath(env)
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    fs.writeFileSync(temporaryPath, `${JSON.stringify({
      version: 1,
      observed_at: observedAt.toISOString(),
      body,
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
 * Codex currently logs `codex.rate_limits` SSE events but does not copy them
 * into rollout token-count events for every provider. The newest event under a
 * Codex home is account-wide, so persist it for other open HUD processes too.
 */
export function readLatestLoggedRateLimits(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): LoggedUsageSnapshot | null {
  const codexHome = getCodexHome(env)
  const cached = cache.get(codexHome)
  if (cached && now - cached.at < CACHE_MS) {
    return cloneSnapshot(cached.value)
  }
  const remember = (value: LoggedUsageSnapshot | null): LoggedUsageSnapshot | null => {
    cache.set(codexHome, { at: now, value: cloneSnapshot(value) })
    return cloneSnapshot(value)
  }
  let previous = readStoredSnapshot(env, now)
  if (cached?.value) {
    const fallback = freshUsage(cached.value.usage, cached.value.observedAt, now)
    if (fallback) {
      previous = { usage: fallback, observedAt: cached.value.observedAt }
    }
  }
  const database = findCodexLogDatabase(codexHome)
  if (!database) {
    return remember(previous)
  }
  const since = Math.floor(now / 1_000) - MAX_EVENT_AGE_SECONDS
  const sql = [
    `SELECT ts || '|' || hex(feedback_log_body)`,
    '  FROM logs',
    ` WHERE id >= (SELECT max(id) - ${MAX_ROW_LOOKBACK} FROM logs)`,
    `   AND ts >= ${since}`,
    `   AND target = 'codex_api::sse::responses'`,
    `   AND instr(feedback_log_body, '"type":"codex.rate_limits"') > 0`,
    ' ORDER BY id DESC',
    ' LIMIT 1;',
  ].join('\n')
  const result = spawnSync('sqlite3', ['-readonly', '-noheader', '-batch', database, sql], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: QUERY_TIMEOUT_MS,
  })
  if (typeof result.stdout !== 'string') {
    return remember(previous)
  }
  for (const line of result.stdout.split('\n')) {
    const [timestampValue, bodyValue] = line.split('|')
    const timestamp = Number(timestampValue)
    const body = decodeHex(bodyValue ?? '')
    if (!Number.isFinite(timestamp) || !body) {
      continue
    }
    const observedAt = new Date(timestamp * 1_000)
    const usage = parseEvent(body)
    const fresh = usage ? freshUsage(usage, observedAt, now) : null
    if (fresh) {
      writeStoredSnapshot(env, body, observedAt, now)
      return remember({ usage: fresh, observedAt })
    }
  }
  return remember(previous)
}
