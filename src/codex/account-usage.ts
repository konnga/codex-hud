// @env node
import type { RawRateLimits, RawRateLimitWindow } from '../types/rollout.js'
import type { UsageData } from '../types/state.js'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { hasApiKeyCredential } from '../collectors/session-metadata.js'
import { getCodexHome, getHudStateDirectory } from '../config/paths.js'
import { findExecutable } from '../runtime/process.js'
import { HUD_VERSION } from '../version.js'
import { mergeUsageData, normalizeAccountRateLimits, observeUsage } from './rate-limits.js'

export const ACCOUNT_USAGE_REFRESH_MS = 60_000
export const ACCOUNT_USAGE_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 256 * 1024
const localAttempts = new Map<string, { at: number, failed: boolean }>()

interface AccountContext {
  key: string
  accountId: string | null
  authModifiedAt: number
  directory: string
  file: string
}

interface StoredUsage {
  version: 1
  attemptedAt: number
  failed: boolean
  observedAt?: number
  limits?: RawRateLimits
}

export interface AccountUsageStatus {
  enabled: boolean
  usage: UsageData | null
  attemptedAt: Date | null
  failed: boolean
  authModifiedAt: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function subject(token: unknown): string | null {
  if (typeof token !== 'string') {
    return null
  }
  try {
    const claims = record(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')))
    return typeof claims?.sub === 'string' ? claims.sub : null
  }
  catch {
    return null
  }
}

function accountContext(endpoint: string | null, env: NodeJS.ProcessEnv): AccountContext | null {
  try {
    if (!endpoint || new URL(endpoint).origin !== 'https://chatgpt.com' || hasApiKeyCredential(env)) {
      return null
    }
    const authPath = path.join(getCodexHome(env), 'auth.json')
    const auth = record(JSON.parse(fs.readFileSync(authPath, 'utf8')))
    const tokens = record(auth?.tokens)
    if (!tokens || typeof tokens.access_token !== 'string' || !tokens.access_token) {
      return null
    }
    const accountId = typeof tokens.account_id === 'string' ? tokens.account_id : null
    // Claims only partition a local cache; Codex validates the actual credential.
    // Include the user as well as workspace, and survive ordinary token refresh.
    const user = subject(tokens.id_token) ?? subject(tokens.access_token)
    const key = createHash('sha256').update(JSON.stringify([accountId, user ?? tokens.access_token])).digest('hex')
    const directory = path.join(getHudStateDirectory(env), 'account-usage')
    return { key, accountId, authModifiedAt: fs.statSync(authPath).mtimeMs, directory, file: path.join(directory, `${key}.json`) }
  }
  catch {
    return null
  }
}

function rawWindow(value: unknown): RawRateLimitWindow | null {
  const window = record(value)
  if (!window) {
    return null
  }
  const remaining = window.remainingPercent
  const used = window.usedPercent
  if (!(typeof used === 'number' && Number.isFinite(used))
    && !(typeof remaining === 'number' && Number.isFinite(remaining))) {
    throw new TypeError('Invalid quota window')
  }
  return {
    used_percent: typeof used === 'number' ? used : null,
    remaining_percent: typeof remaining === 'number' ? remaining : null,
    window_minutes: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
    resets_at: typeof window.resetsAt === 'number' ? window.resetsAt : null,
  }
}

/** Whitelist the documented account bucket; never substitute a model bucket. */
export function accountRateLimits(result: unknown): RawRateLimits | null {
  try {
    const response = record(result)
    const buckets = record(response?.rateLimitsByLimitId)
    const limits = buckets ? record(buckets.codex) : record(response?.rateLimits)
    if (!limits || (limits.limitId != null && limits.limitId !== 'codex')) {
      return null
    }
    const credits = record(limits.credits)
    const raw: RawRateLimits = {
      limit_id: 'codex',
      primary: rawWindow(limits.primary),
      secondary: rawWindow(limits.secondary),
      individual_limit: rawWindow(limits.individualLimit),
      credits: credits ? { has_credits: credits.hasCredits === true, balance: typeof credits.balance === 'string' ? credits.balance : null } : null,
      plan_type: typeof limits.planType === 'string' ? limits.planType : null,
      rate_limit_reached_type: typeof limits.rateLimitReachedType === 'string' ? limits.rateLimitReachedType : null,
      spend_control_reached: limits.spendControlReached === true,
    }
    return raw.primary || raw.secondary || raw.individual_limit || raw.credits ? raw : null
  }
  catch {
    return null
  }
}

function readStored(context: AccountContext): StoredUsage | null {
  try {
    if (fs.statSync(context.file).size > MAX_RESPONSE_BYTES) {
      return null
    }
    const stored = JSON.parse(fs.readFileSync(context.file, 'utf8')) as StoredUsage
    return stored.version === 1 && Number.isFinite(stored.attemptedAt) ? stored : null
  }
  catch {
    return null
  }
}

function writeStored(context: AccountContext, value: StoredUsage): void {
  const temporary = `${context.file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, context.file)
  }
  finally {
    fs.rmSync(temporary, { force: true })
  }
}

function status(context: AccountContext | null): AccountUsageStatus {
  const stored = context ? readStored(context) : null
  const local = context ? localAttempts.get(context.file) : null
  const latest = local && local.at >= (stored?.attemptedAt ?? 0) ? local : null
  const date = stored?.observedAt && Number.isFinite(stored.observedAt) ? new Date(stored.observedAt) : null
  const observedAt = date && !Number.isNaN(date.getTime()) ? date : null
  const usage = observedAt ? observeUsage(normalizeAccountRateLimits(stored?.limits), observedAt, 'account') : null
  return {
    enabled: Boolean(context),
    usage: usage ? { ...usage, complete: true } : null,
    attemptedAt: latest ? new Date(latest.at) : stored ? new Date(stored.attemptedAt) : null,
    failed: latest?.failed ?? stored?.failed === true,
    authModifiedAt: context?.authModifiedAt ?? 0,
  }
}

/** Only initialize, check auth, and read quota. Never start a thread or login. */
export function queryAccountRateLimits(env: NodeJS.ProcessEnv, accountId: string | null): Promise<RawRateLimits | null> {
  // Prefer the managed binary over terminal-owned PATH wrappers (cmux can
  // install a Codex forwarding script even when the real CLI isn't on PATH).
  const executable = findExecutable('codex', { ...env, PATH: '' }) ?? findExecutable('codex', env)
  if (!executable) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const child = spawn(executable, ['app-server', '-c', 'chatgpt_base_url="https://chatgpt.com/backend-api/"'], {
      cwd: getHudStateDirectory(env),
      // The npm Codex launcher uses /usr/bin/env node. Reuse the Node binary
      // already running this HUD even in a GUI pane with a minimal PATH.
      env: { ...env, PATH: [path.dirname(process.execPath), env.PATH].filter(Boolean).join(path.delimiter) },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let done = false
    let buffer = ''
    let bytes = 0
    let expectedId = 0
    let timeout: NodeJS.Timeout
    const kill = (): void => {
      child.kill('SIGKILL')
    }
    const finish = (value: RawRateLimits | null): void => {
      if (done) {
        return
      }
      done = true
      clearTimeout(timeout)
      process.off('exit', kill)
      child.stdin.destroy()
      kill()
      resolve(value)
    }
    timeout = setTimeout(finish, ACCOUNT_USAGE_TIMEOUT_MS, null)
    process.once('exit', kill)
    const send = (value: unknown): void => {
      child.stdin.write(`${JSON.stringify(value)}\n`)
    }
    child.on('error', () => finish(null))
    child.on('close', () => finish(null))
    child.stdin.on('error', () => finish(null))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_RESPONSE_BYTES) {
        finish(null)
        return
      }
      buffer += chunk
      while (buffer.includes('\n')) {
        if (done) {
          break
        }
        const newline = buffer.indexOf('\n')
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const message = record(JSON.parse(line))
          if (message?.id !== expectedId) {
            continue
          }
          if (message.error || !record(message.result)) {
            finish(null)
          }
          else if (expectedId === 0) {
            expectedId = 1
            send({ method: 'initialized', params: {} })
            send({ id: 1, method: 'account/read', params: { refreshToken: false } })
          }
          else if (expectedId === 1) {
            const result = record(message.result)
            if (record(result?.account)?.type !== 'chatgpt') {
              finish(null)
              continue
            }
            expectedId = 2
            send({ id: 2, method: 'account/rateLimits/read' })
          }
          else {
            const result = record(message.result)
            finish(accountId && result?.accountId && result.accountId !== accountId ? null : accountRateLimits(result))
          }
        }
        catch {
          finish(null)
        }
      }
    })
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'codex_hud', version: HUD_VERSION } } })
  })
}

const pending = new Map<string, Promise<AccountUsageStatus>>()

export async function refreshAccountUsage(endpoint: string | null, env: NodeJS.ProcessEnv = process.env): Promise<AccountUsageStatus> {
  const context = accountContext(endpoint, env)
  if (!context) {
    return status(null)
  }
  const existing = pending.get(context.file)
  if (existing) {
    return existing
  }
  const cached = status(context)
  if (cached.attemptedAt && Date.now() >= cached.attemptedAt.getTime() && Date.now() - cached.attemptedAt.getTime() < ACCOUNT_USAGE_REFRESH_MS) {
    return cached
  }
  const run = async (): Promise<AccountUsageStatus> => {
    const lock = `${context.file}.lock`
    let ownsLock = false
    let lockInode: number | null = null
    const stillOwnsLock = (): boolean => {
      try {
        return ownsLock && fs.statSync(lock).ino === lockInode
      }
      catch {
        return false
      }
    }
    try {
      fs.mkdirSync(context.directory, { recursive: true, mode: 0o700 })
      // Recover a crashed reader. Normal requests end well before this lease.
      if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > ACCOUNT_USAGE_TIMEOUT_MS * 3) {
        fs.rmdirSync(lock)
      }
      fs.mkdirSync(lock, { mode: 0o700 })
      ownsLock = true
      lockInode = fs.statSync(lock).ino
      const previous = readStored(context)
      const attemptedAt = Date.now()
      if (previous && attemptedAt >= previous.attemptedAt && attemptedAt - previous.attemptedAt < ACCOUNT_USAGE_REFRESH_MS) {
        return status(context)
      }
      // Persist the attempt too, so failed reads are throttled across HUDs.
      writeStored(context, { ...previous, version: 1, attemptedAt, failed: previous?.failed ?? false })
      const limits = await queryAccountRateLimits(env, context.accountId)
      const current = accountContext(endpoint, env)
      if (current?.key !== context.key) {
        return status(current)
      }
      // A suspended reader may resume after another process recovered its
      // lease. Never overwrite that process's newer result or remove its lock.
      if (!stillOwnsLock() || Date.now() - attemptedAt > ACCOUNT_USAGE_TIMEOUT_MS * 2) {
        return status(context)
      }
      writeStored(context, {
        ...previous,
        version: 1,
        attemptedAt,
        failed: !limits,
        // Request-start time is conservative: a delayed response must not
        // override a rollout observation received while the query was running.
        ...(limits ? { limits, observedAt: attemptedAt } : {}),
      })
      return status(context)
    }
    catch {
      // Failure to acquire another reader's lock is normal. Other filesystem
      // failures still need a local throttle when the attempt cannot be saved.
      if (ownsLock || !fs.existsSync(lock)) {
        if (localAttempts.size >= 64) {
          localAttempts.delete(localAttempts.keys().next().value!)
        }
        localAttempts.set(context.file, { at: Date.now(), failed: true })
      }
      return status(context)
    }
    finally {
      if (stillOwnsLock()) {
        try {
          fs.rmdirSync(lock)
        }
        catch {
          // A crashed or suspended reader may have lost its expired lease.
        }
      }
    }
  }
  const promise = run().finally(() => pending.delete(context.file))
  pending.set(context.file, promise)
  return promise
}

export function readCachedAccountUsage(endpoint: string | null, env: NodeJS.ProcessEnv = process.env, onRefresh?: () => void): AccountUsageStatus {
  const context = accountContext(endpoint, env)
  const current = status(context)
  if (context && !pending.has(context.file) && (!current.attemptedAt || Date.now() - current.attemptedAt.getTime() >= ACCOUNT_USAGE_REFRESH_MS)) {
    void refreshAccountUsage(endpoint, env).then((next) => {
      if (next.attemptedAt?.getTime() !== current.attemptedAt?.getTime()
        || next.usage?.observedAt?.getTime() !== current.usage?.observedAt?.getTime()
        || next.failed !== current.failed) {
        onRefresh?.()
      }
    })
  }
  return current
}

export function selectAccountUsage(rollout: UsageData | null, logged: UsageData | null, account: AccountUsageStatus | null): UsageData | null {
  // Origin-only legacy caches cannot establish which signed-in account owned
  // an observation. With an identified account, use its cache and recent local
  // rollout observations only; reject observations predating the auth file.
  const local = account?.enabled
    ? rollout?.observedAt && rollout.observedAt.getTime() >= account.authModifiedAt ? rollout : null
    : rollout
  let usage = mergeUsageData(local, account?.enabled ? account.usage : logged)
  if (usage && account?.failed) {
    usage = { ...usage, refreshFailed: true }
  }
  return usage
}
