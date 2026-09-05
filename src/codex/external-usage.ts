import type { DisplayConfig, ExternalUsageQueryConfig } from '../types/config.js'
import type { UsageData, UsageWindow } from '../types/state.js'
// @env node
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getCodexHome } from '../config/paths.js'
import { setTimedCache } from '../runtime/timed-cache.js'
import { HUD_VERSION } from '../version.js'
import { isOfficialOpenAIEndpoint } from './session-endpoint.js'

interface SnapshotWindow {
  used_percentage?: number
  used_percent?: number
  resets_at?: string | number | null
  window_minutes?: number | null
}

interface UsageSnapshot {
  updated_at?: string | number
  five_hour?: SnapshotWindow | null
  seven_day?: SnapshotWindow | null
  individual?: SnapshotWindow | null
  balance_label?: string | null
}

const MAX_BALANCE_LABEL = 80
const MAX_RESPONSE_BYTES = 64 * 1024
const WRITE_HEARTBEAT_MS = 60_000
const WRITE_CACHE_MAX_AGE_MS = 30 * 60_000
const WRITE_CACHE_MAX_ENTRIES = 64
const QUERY_FAILURE_RETRY_MS = 15_000
const QUERY_STALE_MAX_MS = 15 * 60_000
const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60_000
const QUERY_CACHE_MAX_ENTRIES = 64
const lastWrites = new Map<string, { fingerprint: string, at: number }>()
const queryCache = new Map<string, { at: number, valueAt: number, failedAt?: number, value: UsageData | null }>()
const inFlightQueries = new Map<string, Promise<UsageData | null>>()

interface NewApiUserResponse {
  success?: boolean
  data?: {
    quota?: unknown
    group?: unknown
  }
}

interface Sub2ApiUserResponse {
  code?: unknown
  data?: {
    balance?: unknown
  }
}

interface GeneralBalanceResponse {
  balance?: unknown
  remaining?: unknown
  unit?: unknown
  planName?: unknown
  isValid?: unknown
}

function safePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : null
}

function safeReset(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function sanitizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const label = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return label ? label.slice(0, MAX_BALANCE_LABEL) : null
}

function formatCredits(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function usageData(balanceLabel: string): UsageData {
  return {
    primary: null,
    secondary: null,
    individual: null,
    planType: null,
    balanceLabel,
    limitReachedType: null,
  }
}

function credentialFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

async function responseJson(response: Response): Promise<unknown | null> {
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const declaredLength = Number(contentLength)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return null
    }
  }
  try {
    if (!response.body) {
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
        return null
      }
      return JSON.parse(text) as unknown
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const result = await reader.read()
        if (result.done) {
          break
        }
        size += result.value.byteLength
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(result.value)
      }
    }
    finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }
  catch {
    return null
  }
}

function newApiUsage(body: unknown, quotaPerCredit: number): UsageData | null {
  const response = body as NewApiUserResponse
  const quota = response?.success === true && typeof response.data?.quota === 'number' && Number.isFinite(response.data.quota)
    ? response.data.quota
    : null
  if (quota === null) {
    return null
  }
  const group = sanitizeLabel(response.data?.group)
  const prefix = group ? `${group}: ` : ''
  return usageData(`${prefix}$${formatCredits(Math.max(0, quota) / quotaPerCredit)}`)
}

function sub2ApiUsage(body: unknown): UsageData | null {
  const response = body as Sub2ApiUserResponse
  const balance = response?.code === 0 && typeof response.data?.balance === 'number' && Number.isFinite(response.data.balance)
    ? response.data.balance
    : null
  if (balance === null) {
    return null
  }
  return usageData(`$${formatCredits(Math.max(0, balance))}`)
}

function generalUsage(body: unknown): UsageData | null {
  const response = body as GeneralBalanceResponse
  if (response?.isValid === false) {
    return null
  }
  const rawBalance = response?.remaining ?? response?.balance
  const balance = typeof rawBalance === 'number' && Number.isFinite(rawBalance)
    ? rawBalance
    : null
  if (balance === null) {
    return null
  }
  const unit = sanitizeLabel(response.unit) ?? 'USD'
  const planName = sanitizeLabel(response.planName)
  const amount = formatCredits(Math.max(0, balance))
  const formatted = unit === 'USD' ? `$${amount}` : `${amount} ${unit}`
  return usageData(planName ? `${planName}: ${formatted}` : formatted)
}

function generalQueryUrls(endpoint: string, origin: string): string[] {
  const urls = [`${origin}/user/balance`]
  try {
    const requestUrl = new URL(endpoint)
    const basePath = requestUrl.pathname.replace(/\/(?:responses|chat\/completions)\/?$/, '')
    const usageUrl = `${origin}${basePath}/usage`.replace(/([^:]\/)\/+/, '$1')
    if (!urls.includes(usageUrl)) {
      urls.push(usageUrl)
    }
  }
  catch {
    // configuredQuery already validates endpoint; keep the standard URL only.
  }
  return urls
}

function configuredQuery(
  queries: ExternalUsageQueryConfig[],
  endpoint: string | null,
): ExternalUsageQueryConfig | null {
  if (!endpoint) {
    return null
  }
  let origin: string
  try {
    origin = new URL(endpoint).origin.toLowerCase()
    const originUrl = new URL(origin)
    const hostname = originUrl.hostname.toLowerCase()
    const safeTransport = originUrl.protocol === 'https:'
      || (originUrl.protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'))
    if (!safeTransport) {
      return null
    }
  }
  catch {
    return null
  }
  if (isOfficialOpenAIEndpoint(origin)) {
    return null
  }
  const query = queries.find(query => query.enabled && query.origin === origin)
    ?? queries.find(query => query.enabled && query.origin === '*' && query.template === 'general')
  return query ? { ...query, origin } : null
}

function inferenceApiKey(env: NodeJS.ProcessEnv): string | null {
  if (env.OPENAI_API_KEY) {
    return env.OPENAI_API_KEY
  }
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(getCodexHome(env), 'auth.json'), 'utf8')) as Record<string, unknown>
    return typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY ? auth.OPENAI_API_KEY : null
  }
  catch {
    return null
  }
}

interface ConfiguredQueryContext {
  query: ExternalUsageQueryConfig
  endpoint: string
  accessToken: string
  userId: string | undefined
  cacheKey: string
}

function configuredQueryContext(
  queries: ExternalUsageQueryConfig[],
  endpoint: string | null,
  env: NodeJS.ProcessEnv,
): ConfiguredQueryContext | null {
  const query = configuredQuery(queries, endpoint)
  if (!query || !endpoint) {
    return null
  }
  const credentialEnv = query.template === 'general' ? query.apiKeyEnv : query.accessTokenEnv
  const accessToken = query.template === 'general'
    ? credentialEnv ? env[credentialEnv] : inferenceApiKey(env)
    : env[credentialEnv]
  const userId = env[query.userIdEnv]
  if (!accessToken || (query.template === 'newApi' && !userId)) {
    return null
  }
  return {
    query,
    endpoint,
    accessToken,
    userId,
    cacheKey: [
      query.origin,
      query.template,
      credentialEnv,
      query.userIdEnv,
      query.quotaPerCredit,
      credentialFingerprint(accessToken),
      query.template === 'newApi' ? credentialFingerprint(userId!) : '',
    ].join(':'),
  }
}

function cachedQueryValue(
  cached: { valueAt: number, value: UsageData | null } | undefined,
  now: number,
): UsageData | null {
  return cached?.value && now - cached.valueAt <= QUERY_STALE_MAX_MS
    ? structuredClone(cached.value)
    : null
}

async function performConfiguredQuery(context: ConfiguredQueryContext, now: number): Promise<UsageData | null> {
  const { query, endpoint, accessToken, userId, cacheKey } = context
  const cached = queryCache.get(cacheKey)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  let value: UsageData | null = null
  try {
    const urls = query.template === 'general'
      ? generalQueryUrls(endpoint, query.origin)
      : [`${query.origin}${query.template === 'newApi' ? '/api/user/self' : '/api/v1/auth/me'}`]
    for (const url of urls) {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': `codex-hud/${HUD_VERSION}`,
          ...(query.template === 'newApi' ? { 'New-Api-User': userId! } : {}),
        },
        redirect: 'error',
        signal: controller.signal,
      })
      if (!response.ok) {
        continue
      }
      const body = await responseJson(response)
      if (body === null) {
        continue
      }
      value = query.template === 'general'
        ? generalUsage(body)
        : query.template === 'newApi' ? newApiUsage(body, query.quotaPerCredit) : sub2ApiUsage(body)
      if (value) {
        break
      }
    }
  }
  catch {
    // Queries are optional and must not disrupt local HUD data.
  }
  finally {
    clearTimeout(timeout)
  }
  if (value) {
    setTimedCache(queryCache, cacheKey, {
      at: now,
      valueAt: now,
      value: structuredClone(value),
    }, QUERY_CACHE_MAX_AGE_MS, QUERY_CACHE_MAX_ENTRIES)
    return structuredClone(value)
  }
  setTimedCache(queryCache, cacheKey, {
    at: now,
    valueAt: cached?.valueAt ?? 0,
    failedAt: now,
    value: cached?.value ? structuredClone(cached.value) : null,
  }, QUERY_CACHE_MAX_AGE_MS, QUERY_CACHE_MAX_ENTRIES)
  return cachedQueryValue(cached, now)
}

function startConfiguredQuery(context: ConfiguredQueryContext, now: number): Promise<UsageData | null> {
  const existing = inFlightQueries.get(context.cacheKey)
  if (existing) {
    return existing
  }
  const promise = performConfiguredQuery(context, now).finally(() => {
    inFlightQueries.delete(context.cacheKey)
  })
  inFlightQueries.set(context.cacheKey, promise)
  return promise
}

/**
 * Query a matching relay balance endpoint. Dedicated credentials are read
 * only from named environment variables and never persisted.
 */
export async function readConfiguredExternalUsage(
  queries: ExternalUsageQueryConfig[],
  endpoint: string | null,
  env: NodeJS.ProcessEnv,
  now = Date.now(),
): Promise<UsageData | null> {
  const context = configuredQueryContext(queries, endpoint, env)
  if (!context) {
    return null
  }
  const cached = queryCache.get(context.cacheKey)
  if (cached?.valueAt && now - cached.valueAt < context.query.refreshMs) {
    return cached.value ? structuredClone(cached.value) : null
  }
  if (cached?.failedAt && now - cached.failedAt < QUERY_FAILURE_RETRY_MS) {
    return cachedQueryValue(cached, now)
  }
  return startConfiguredQuery(context, now)
}

export function readCachedConfiguredExternalUsage(
  queries: ExternalUsageQueryConfig[],
  endpoint: string | null,
  env: NodeJS.ProcessEnv,
  onUpdate: () => void,
  now = Date.now(),
): UsageData | null {
  const context = configuredQueryContext(queries, endpoint, env)
  if (!context) {
    return null
  }
  const cached = queryCache.get(context.cacheKey)
  if (cached?.valueAt && now - cached.valueAt < context.query.refreshMs) {
    return cached.value ? structuredClone(cached.value) : null
  }
  if (!cached?.failedAt || now - cached.failedAt >= QUERY_FAILURE_RETRY_MS) {
    if (!inFlightQueries.has(context.cacheKey)) {
      void startConfiguredQuery(context, now).finally(onUpdate)
    }
  }
  return cachedQueryValue(cached, now)
}

function snapshotWindow(value: SnapshotWindow | null | undefined, label: string, fallbackMinutes: number): UsageWindow | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const percent = safePercent(value.used_percentage ?? value.used_percent)
  if (percent === null) {
    return null
  }
  return {
    label,
    percent,
    resetAt: safeReset(value.resets_at),
    windowMinutes: typeof value.window_minutes === 'number' && value.window_minutes > 0
      ? value.window_minutes
      : fallbackMinutes,
  }
}

function validSnapshotPath(filePath: string, write = false): boolean {
  if (!filePath || !path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.json')) {
    return false
  }
  if (!write) {
    return true
  }
  try {
    return fs.statSync(path.dirname(filePath)).isDirectory()
  }
  catch {
    return false
  }
}

export function readExternalUsage(
  filePath: string,
  freshnessMs: number,
  now = new Date(),
): UsageData | null {
  if (!validSnapshotPath(filePath)) {
    return null
  }
  try {
    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8')) as UsageSnapshot
    const updatedAt = safeReset(snapshot.updated_at)
    if (!updatedAt || Math.abs(now.getTime() - updatedAt.getTime()) > freshnessMs) {
      return null
    }
    const primary = snapshotWindow(snapshot.five_hour, '5h', 300)
    const secondary = snapshotWindow(snapshot.seven_day, '1w', 10_080)
    const individual = snapshotWindow(snapshot.individual, 'spend', 43_200)
    const balanceLabel = sanitizeLabel(snapshot.balance_label)
    if (!primary && !secondary && !individual && !balanceLabel) {
      return null
    }
    return {
      primary,
      secondary,
      individual,
      planType: null,
      balanceLabel,
      limitReachedType: null,
    }
  }
  catch {
    return null
  }
}

function serializableWindow(window: UsageWindow | null): SnapshotWindow | null {
  if (!window || window.percent === null) {
    return null
  }
  return {
    used_percentage: window.percent,
    resets_at: window.resetAt?.toISOString() ?? null,
    window_minutes: window.windowMinutes ?? null,
  }
}

export function writeExternalUsage(filePath: string, usage: UsageData, now = new Date()): void {
  if (!validSnapshotPath(filePath, true)) {
    return
  }
  const content = {
    five_hour: serializableWindow(usage.primary),
    seven_day: serializableWindow(usage.secondary),
    individual: serializableWindow(usage.individual),
    balance_label: usage.balanceLabel,
  }
  const fingerprint = JSON.stringify(content)
  const previous = lastWrites.get(filePath)
  if (previous?.fingerprint === fingerprint && now.getTime() - previous.at < WRITE_HEARTBEAT_MS) {
    return
  }
  const snapshot: UsageSnapshot = { updated_at: now.toISOString(), ...content }
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(filePath, 0o600)
    setTimedCache(lastWrites, filePath, { fingerprint, at: now.getTime() }, WRITE_CACHE_MAX_AGE_MS, WRITE_CACHE_MAX_ENTRIES)
  }
  catch {
    // Sidecar snapshots are optional and must never break the HUD.
  }
}

export function resolveUsageData(
  nativeUsage: UsageData | null,
  display: Pick<DisplayConfig, 'externalUsagePath' | 'externalUsageWritePath' | 'externalUsageFreshnessMs'>,
  now = new Date(),
): UsageData | null {
  const external = readExternalUsage(display.externalUsagePath, display.externalUsageFreshnessMs, now)
  if (nativeUsage) {
    if (display.externalUsageWritePath) {
      writeExternalUsage(display.externalUsageWritePath, nativeUsage, now)
    }
    return external?.balanceLabel && !nativeUsage.balanceLabel
      ? { ...nativeUsage, balanceLabel: external.balanceLabel }
      : nativeUsage
  }
  return external
}
