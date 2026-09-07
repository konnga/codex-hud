import type { ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPreset } from '../config/presets.js'
import { renderUsageLine } from '../render/usage-line.js'
import { ACCOUNT_USAGE_REFRESH_MS, ACCOUNT_USAGE_TIMEOUT_MS, accountRateLimits, queryAccountRateLimits, readCachedAccountUsage, refreshAccountUsage, selectAccountUsage } from './account-usage.js'
import { normalizeAccountRateLimits, observeUsage } from './rate-limits.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('../runtime/process.js', () => ({ findExecutable: () => '/codex' }))

const directories: string[] = []
const endpoint = 'https://chatgpt.com/backend-api/'
const now = Date.parse('2026-09-06T15:33:00Z')
let clock = now

function setup(account = 'workspace-a', user = 'user-a') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-account-test-'))
  directories.push(home)
  const env = { CODEX_HOME: home }
  const auth = (accountId = account, sub = user) => {
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ tokens: {
      account_id: accountId,
      access_token: 'secret-access-token',
      id_token: `header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`,
    } }))
    fs.utimesSync(path.join(home, 'auth.json'), new Date(clock - 1000), new Date(clock - 1000))
  }
  auth()
  return { home, env, auth }
}

function response(percent = 65) {
  return {
    accountId: 'workspace-a',
    rateLimits: { limitId: 'codex_bengalfox', primary: { usedPercent: 0 } },
    rateLimitsByLimitId: { codex: {
      limitId: 'codex',
      primary: { usedPercent: percent, windowDurationMins: 10080, resetsAt: now / 1000 + 604800 },
      secondary: null,
      individualLimit: null,
      credits: { hasCredits: false, balance: '0' },
      planType: 'pro',
    } },
  }
}

function server(result: unknown = response(), options: { fail?: boolean, wait?: boolean, authType?: string } = {}) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() })
  const sent: Record<string, unknown>[] = []
  let held: (() => void) | undefined
  child.stdin.on('data', (chunk: Buffer) => {
    const message = JSON.parse(chunk.toString()) as Record<string, unknown>
    sent.push(message)
    if (message.id === undefined) {
      return
    }
    const reply = () => child.stdout.write(`${JSON.stringify({ id: message.id, ...(options.fail && message.id === 2
      ? { error: { code: -1, message: 'secret must not escape' } }
      : {
          result: message.id === 0 ? {} : message.id === 1 ? { account: { type: options.authType ?? 'chatgpt' } } : result,
        }) })}\n`)
    if (options.wait && message.id === 2) {
      held = reply
    }
    else {
      queueMicrotask(reply)
    }
  })
  vi.mocked(spawn).mockReturnValueOnce(child as unknown as ChildProcess)
  return { child, sent, reply: () => held?.() }
}

beforeEach(() => {
  clock = now
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  vi.mocked(spawn).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

describe('account quota polling', () => {
  it('reads the account bucket through the documented handshake and stores only quota', async () => {
    const { env, home } = setup()
    const rpc = server()
    const result = await refreshAccountUsage(endpoint, env)
    expect(result).toMatchObject({ enabled: true, failed: false, usage: { primary: { percent: 65 }, source: 'account', observedAt: new Date(now) } })
    expect(rpc.sent.map(message => message.method)).toEqual(['initialize', 'initialized', 'account/read', 'account/rateLimits/read'])
    expect(rpc.child.kill).toHaveBeenCalledWith('SIGKILL')
    const directory = path.join(home, 'codex-hud', 'account-usage')
    const file = path.join(directory, fs.readdirSync(directory)[0])
    expect(fs.readFileSync(file, 'utf8')).not.toMatch(/secret|workspace-a|user-a|signature/)
    if (process.platform !== 'win32') {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    }
    expect(spawn).toHaveBeenCalledWith('/codex', ['app-server', '-c', 'chatgpt_base_url="https://chatgpt.com/backend-api/"'], expect.objectContaining({ stdio: ['pipe', 'pipe', 'ignore'] }))
    expect(vi.mocked(spawn).mock.calls[0][2]?.env?.PATH?.split(path.delimiter)[0]).toBe(path.dirname(process.execPath))
  })

  it('refreshes without new rollout events, merges concurrent reads, and shares the minute throttle', async () => {
    const { env } = setup()
    server()
    const first = await Promise.all([refreshAccountUsage(endpoint, env), refreshAccountUsage(endpoint, env)])
    expect(first[0]).toEqual(first[1])
    expect(spawn).toHaveBeenCalledTimes(1)
    // A separate module has no process-local pending map, like a sibling HUD.
    vi.resetModules()
    const sibling = await import('./account-usage.js')
    expect((await sibling.refreshAccountUsage(endpoint, env)).usage?.primary?.percent).toBe(65)
    expect(spawn).toHaveBeenCalledTimes(1)
    clock += ACCOUNT_USAGE_REFRESH_MS
    server(response(66))
    const updated = vi.fn()
    expect(readCachedAccountUsage(endpoint, env, updated).usage?.primary?.percent).toBe(65)
    await refreshAccountUsage(endpoint, env)
    expect(readCachedAccountUsage(endpoint, env).usage?.primary?.percent).toBe(66)
    expect(updated).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('serializes simultaneous sibling HUD refreshes with a filesystem lock', async () => {
    const { env } = setup()
    const rpc = server(response(), { wait: true })
    const running = refreshAccountUsage(endpoint, env)
    vi.resetModules()
    const sibling = await import('./account-usage.js')
    const other = await sibling.refreshAccountUsage(endpoint, env)
    expect(other.usage).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
    rpc.reply()
    await running
    expect((await sibling.refreshAccountUsage(endpoint, env)).usage?.primary?.percent).toBe(65)
  })

  it('retains last success and its timestamp after errors, and throttles failures', async () => {
    const { env } = setup()
    server()
    await refreshAccountUsage(endpoint, env)
    clock += ACCOUNT_USAGE_REFRESH_MS
    server(null, { fail: true })
    const failed = await refreshAccountUsage(endpoint, env)
    expect(failed).toMatchObject({ failed: true, usage: { observedAt: new Date(now), primary: { percent: 65 } } })
    expect(selectAccountUsage(null, null, failed)?.refreshFailed).toBe(true)
    expect(JSON.stringify(failed)).not.toContain('secret')
    await refreshAccountUsage(endpoint, env)
    expect(spawn).toHaveBeenCalledTimes(2)
    clock += ACCOUNT_USAGE_REFRESH_MS
    server(response(67))
    expect((await refreshAccountUsage(endpoint, env)).failed).toBe(false)
  })

  it('bounds a hung process and releases the shared lease', async () => {
    const { env, home } = setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const rpc = server(null, { wait: true })
    const running = refreshAccountUsage(endpoint, env)
    await vi.advanceTimersByTimeAsync(ACCOUNT_USAGE_TIMEOUT_MS)
    expect(await running).toMatchObject({ failed: true, usage: null })
    expect(rpc.child.kill).toHaveBeenCalled()
    expect(fs.readdirSync(path.join(home, 'codex-hud', 'account-usage')).some(file => file.endsWith('.lock'))).toBe(false)
  })

  it('throttles filesystem failures without a render/retry loop', async () => {
    const { env, home } = setup()
    fs.writeFileSync(path.join(home, 'codex-hud'), 'not a directory')
    const updated = vi.fn()
    readCachedAccountUsage(endpoint, env, updated)
    const failed = await refreshAccountUsage(endpoint, env)
    expect(failed).toMatchObject({ failed: true, attemptedAt: new Date(now) })
    expect(updated).toHaveBeenCalledOnce()
    readCachedAccountUsage(endpoint, env, updated)
    await Promise.resolve()
    expect(updated).toHaveBeenCalledOnce()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('recovers a crashed lock without accepting a late response from its former owner', async () => {
    const { env, home } = setup()
    const slow = server(response(58), { wait: true })
    const running = refreshAccountUsage(endpoint, env)
    await Promise.resolve()
    await Promise.resolve()
    const directory = path.join(home, 'codex-hud', 'account-usage')
    const lock = path.join(directory, fs.readdirSync(directory).find(file => file.endsWith('.lock'))!)
    fs.utimesSync(lock, new Date(now), new Date(now))
    clock += ACCOUNT_USAGE_REFRESH_MS
    vi.resetModules()
    const sibling = await import('./account-usage.js')
    server(response(65))
    expect((await sibling.refreshAccountUsage(endpoint, env)).usage?.primary?.percent).toBe(65)
    slow.reply()
    expect((await running).usage?.primary?.percent).toBe(65)
  })

  it('bounds malformed and oversized protocol output and handles process failure', async () => {
    const { env } = setup()
    for (const value of ['not-json\n', 'x'.repeat(256 * 1024 + 1)]) {
      const rpc = server(null, { wait: true })
      const running = queryAccountRateLimits(env, 'workspace-a')
      rpc.child.stdout.write(value)
      expect(await running).toBeNull()
      expect(rpc.child.kill).toHaveBeenCalled()
    }
    const rpc = server(null, { wait: true })
    const running = queryAccountRateLimits(env, 'workspace-a')
    rpc.child.emit('error', new Error('unavailable'))
    expect(await running).toBeNull()
  })

  it('does not query relays, API key users, or absent credentials', async () => {
    const { env, home } = setup()
    for (const url of [null, 'https://relay.example.com', 'https://api.openai.com', 'http://chatgpt.com']) {
      expect((await refreshAccountUsage(url, env)).enabled).toBe(false)
    }
    expect((await refreshAccountUsage(endpoint, { ...env, OPENAI_API_KEY: 'api-key' })).enabled).toBe(false)
    fs.rmSync(path.join(home, 'auth.json'))
    expect((await refreshAccountUsage(endpoint, env)).enabled).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects non-ChatGPT app-server auth and mismatched response accounts', async () => {
    const { env } = setup()
    const rpc = server(response(), { authType: 'apiKey' })
    expect(await queryAccountRateLimits(env, 'workspace-a')).toBeNull()
    expect(rpc.sent.some(message => message.method === 'account/rateLimits/read')).toBe(false)
    server({ ...response(), accountId: 'another-account' })
    expect(await queryAccountRateLimits(env, 'workspace-a')).toBeNull()
  })

  it('partitions by user within a workspace and discards in-flight results on account switch', async () => {
    const { env, auth } = setup()
    server()
    await refreshAccountUsage(endpoint, env)
    auth('workspace-a', 'user-b')
    server(null, { fail: true })
    expect((await refreshAccountUsage(endpoint, env)).usage).toBeNull()
    auth('workspace-c', 'user-c')
    const rpc = server({ ...response(), accountId: 'workspace-c' }, { wait: true })
    const pending = refreshAccountUsage(endpoint, env)
    await Promise.resolve()
    await Promise.resolve()
    auth('workspace-d', 'user-d')
    rpc.reply()
    expect((await pending).usage).toBeNull()
  })

  it('keeps token refreshes for the same user in the same cache', async () => {
    const { env, home } = setup()
    server()
    await refreshAccountUsage(endpoint, env)
    const file = path.join(home, 'auth.json')
    const auth = JSON.parse(fs.readFileSync(file, 'utf8'))
    auth.tokens.access_token = 'rotated-secret'
    fs.writeFileSync(file, JSON.stringify(auth))
    expect((await refreshAccountUsage(endpoint, env)).usage?.primary?.percent).toBe(65)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

describe('account normalization and selection', () => {
  it('ignores model-only or malformed results, and accepts the legacy single bucket', () => {
    expect(accountRateLimits({ rateLimitsByLimitId: { codex_bengalfox: {} }, rateLimits: response().rateLimits })).toBeNull()
    expect(accountRateLimits({ rateLimits: { limitId: 'codex', primary: { usedPercent: '65' } } })).toBeNull()
    expect(accountRateLimits({ rateLimits: response().rateLimitsByLimitId.codex })?.primary?.used_percent).toBe(65)
    const raw = accountRateLimits({ rateLimits: { ...response().rateLimitsByLimitId.codex, individualLimit: { remainingPercent: 35, resetsAt: now / 1000 + 300 } } })
    expect(normalizeAccountRateLimits(raw)?.individual?.percent).toBe(65)
  })

  it('never lets older observations override newer data, including legitimate quota resets', () => {
    const snapshot = (percent: number, at: number) => observeUsage(normalizeAccountRateLimits({ primary: { used_percent: percent, window_minutes: 10080 } }), new Date(at), 'rollout')!
    const account = { enabled: true, usage: { ...snapshot(65, now), source: 'account' as const, complete: true }, attemptedAt: new Date(now), failed: false, authModifiedAt: now - 10000 }
    expect(selectAccountUsage(snapshot(58, now - 5000), null, account)?.primary?.percent).toBe(65)
    expect(selectAccountUsage(snapshot(66, now + 1000), null, account)?.primary?.percent).toBe(66)
    account.usage = { ...account.usage, ...snapshot(0, now + 2000), source: 'account', complete: true }
    expect(selectAccountUsage(snapshot(66, now + 1000), null, account)?.primary?.percent).toBe(0)
    // Never import an unscoped legacy snapshot or pre-login rollout.
    expect(selectAccountUsage(snapshot(98, now - 20000), snapshot(99, now + 9000), { ...account, usage: null })).toBeNull()
  })

  it('marks stale and failed values with their actual observation time in both languages', () => {
    const usage = observeUsage(normalizeAccountRateLimits({ primary: { used_percent: 65, window_minutes: 10080 } }), new Date(now), 'account')!
    const ctx = { config: createPreset('full'), state: { usage } as Parameters<typeof renderUsageLine>[0]['state'], options: { color: false, width: 160, height: 10 }, now: new Date(now) }
    expect(renderUsageLine(ctx)).not.toContain('cached')
    ctx.now = new Date(now + 90000)
    expect(renderUsageLine(ctx)).toContain('65% [cached, updated ')
    ctx.config.language = 'zh-Hans'
    expect(renderUsageLine(ctx)).toContain('65% [缓存, 更新于 ')
    ctx.now = new Date(now)
    ctx.state.usage!.refreshFailed = true
    expect(renderUsageLine(ctx)).toContain('[缓存, 更新于 ')
  })
})
