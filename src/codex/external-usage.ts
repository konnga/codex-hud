import type { DisplayConfig, ExternalUsageQueryConfig } from '../types/config.js'
import type { UsageData, UsageWindow } from '../types/state.js'
// @env node
import fs from 'node:fs'
import path from 'node:path'
import { getCodexHome } from '../config/paths.js'
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
const WRITE_HEARTBEAT_MS = 60_000
const QUERY_FAILURE_RETRY_MS = 15_000
const lastWrites = new Map<string, { fingerprint: string, at: number }>()
const queryCache = new Map<string, { at: number, failedAt?: number, value: UsageData | null }>()

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
  return {
    primary: null,
    secondary: null,
    individual: null,
    planType: null,
    balanceLabel: `${prefix}$${formatCredits(Math.max(0, quota) / quotaPerCredit)}`,
    limitReachedType: null,
  }
}

function sub2ApiUsage(body: unknown): UsageData | null {
  const response = body as Sub2ApiUserResponse
  const balance = response?.code === 0 && typeof response.data?.balance === 'number' && Number.isFinite(response.data.balance)
    ? response.data.balance
    : null
  if (balance === null) {
    return null
  }
  return {
    primary: null,
    secondary: null,
    individual: null,
    planType: null,
    balanceLabel: `$${formatCredits(Math.max(0, balance))}`,
    limitReachedType: null,
  }
}

function generalUsage(body: unknown): UsageData | null {
  const response = body as GeneralBalanceResponse
  const balance = typeof response?.balance === 'number' && Number.isFinite(response.balance)
    ? response.balance
    : null
  if (balance === null) {
    return null
  }
  return {
    primary: null,
    secondary: null,
    individual: null,
    planType: null,
    balanceLabel: `$${formatCredits(Math.max(0, balance))}`,
    limitReachedType: null,
  }
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
  const query = configuredQuery(queries, endpoint)
  if (!query) {
    return null
  }
  const credentialEnv = query.template === 'general' ? query.apiKeyEnv : query.accessTokenEnv
  const accessToken = query.template === 'general'
    ? (credentialEnv ? env[credentialEnv] : null) ?? inferenceApiKey(env)
    : env[credentialEnv]
  const userId = env[query.userIdEnv]
  if (!accessToken || (query.template === 'newApi' && !userId)) {
    return null
  }
  const cacheKey = `${query.origin}:${query.template}:${credentialEnv}:${query.userIdEnv}`
  const cached = queryCache.get(cacheKey)
  if (cached && now - cached.at < query.refreshMs) {
    return cached.value ? structuredClone(cached.value) : null
  }
  if (cached?.failedAt && now - cached.failedAt < QUERY_FAILURE_RETRY_MS) {
    return cached.value ? structuredClone(cached.value) : null
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3_000)
  let value: UsageData | null = null
  try {
    const path = query.template === 'general'
      ? '/user/balance'
      : query.template === 'newApi' ? '/api/user/self' : '/api/v1/auth/me'
    const response = await fetch(`${query.origin}${path}`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'codex-hud/0.4',
        ...(query.template === 'newApi' ? { 'New-Api-User': userId! } : {}),
      },
      signal: controller.signal,
    })
    if (response.ok) {
      const body: unknown = await response.json()
      value = query.template === 'general'
        ? generalUsage(body)
        : query.template === 'newApi' ? newApiUsage(body, query.quotaPerCredit) : sub2ApiUsage(body)
    }
  }
  catch {
    // Queries are optional and must not disrupt local HUD data.
  }
  finally {
    clearTimeout(timeout)
  }
  if (value) {
    queryCache.set(cacheKey, { at: now, value: structuredClone(value) })
    return structuredClone(value)
  }
  queryCache.set(cacheKey, {
    at: cached?.at ?? 0,
    failedAt: now,
    value: cached?.value ? structuredClone(cached.value) : null,
  })
  return cached?.value ? structuredClone(cached.value) : null
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
    lastWrites.set(filePath, { fingerprint, at: now.getTime() })
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
