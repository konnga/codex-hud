import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readCachedConfiguredExternalUsage, readConfiguredExternalUsage, readExternalUsage, resolveUsageData } from './external-usage.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
  vi.unstubAllGlobals()
})

describe('external usage snapshots', () => {
  it('reads fresh absolute snapshots and ignores stale data', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-usage-'))
    directories.push(directory)
    const filePath = path.join(directory, 'usage.json')
    fs.writeFileSync(filePath, JSON.stringify({
      updated_at: '2026-07-16T09:00:00Z',
      five_hour: { used_percentage: 42, resets_at: '2026-07-16T10:00:00Z' },
      seven_day: { used_percentage: 84, resets_at: '2026-07-20T09:00:00Z' },
      balance_label: '$8.25\u001B[2J',
    }))
    expect(readExternalUsage(filePath, 300_000, new Date('2026-07-16T09:01:00Z'))).toMatchObject({
      primary: { percent: 42 },
      secondary: { percent: 84 },
      balanceLabel: '$8.25 [2J',
    })
    expect(readExternalUsage(filePath, 1_000, new Date('2026-07-16T09:01:00Z'))).toBeNull()
  })

  it('uses external windows as fallback and writes native snapshots privately', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-usage-'))
    directories.push(directory)
    const readPath = path.join(directory, 'read.json')
    const writePath = path.join(directory, 'write.json')
    fs.writeFileSync(readPath, JSON.stringify({
      updated_at: '2026-07-16T09:00:00Z',
      five_hour: { used_percentage: 42 },
      balance_label: 'credits 9',
    }))
    const display = { externalUsagePath: readPath, externalUsageWritePath: writePath, externalUsageFreshnessMs: 300_000 }
    expect(resolveUsageData(null, display, new Date('2026-07-16T09:01:00Z'))?.primary?.percent).toBe(42)
    const native = {
      primary: { label: '5h', percent: 25, resetAt: null, windowMinutes: 300 },
      secondary: null,
      individual: null,
      planType: 'pro',
      balanceLabel: null,
      limitReachedType: null,
    }
    expect(resolveUsageData(native, display, new Date('2026-07-16T09:01:00Z'))?.balanceLabel).toBe('credits 9')
    expect(JSON.parse(fs.readFileSync(writePath, 'utf8')).five_hour.used_percentage).toBe(25)
    if (process.platform !== 'win32') {
      expect(fs.statSync(writePath).mode & 0o777).toBe(0o600)
    }
  })

  it('queries an explicitly enabled New API endpoint with separate management credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { quota: 6_250_000, group: 'coding' },
    })))
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      enabled: true,
      origin: 'https://relay.example.com',
      template: 'newApi' as const,
      apiKeyEnv: '',
      accessTokenEnv: 'RELAY_ACCESS_TOKEN',
      userIdEnv: 'RELAY_USER_ID',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }

    await expect(readConfiguredExternalUsage(
      [query],
      'https://relay.example.com/v1/responses',
      { RELAY_ACCESS_TOKEN: 'management-token', RELAY_USER_ID: '42' },
      Date.parse('2026-08-12T08:00:00Z'),
    )).resolves.toMatchObject({ balanceLabel: 'coding: $12.5' })
    expect(fetchMock).toHaveBeenCalledWith('https://relay.example.com/api/user/self', expect.objectContaining({
      headers: expect.objectContaining({
        'Authorization': 'Bearer management-token',
        'New-Api-User': '42',
      }),
    }))

    await readConfiguredExternalUsage([query], 'https://relay.example.com/v1/responses', {
      RELAY_ACCESS_TOKEN: 'management-token',
      RELAY_USER_ID: '42',
    }, Date.parse('2026-08-12T08:00:01Z'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not issue network requests when the query is disabled or the endpoint differs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      enabled: false,
      origin: 'https://relay-disabled.example.com',
      template: 'newApi' as const,
      apiKeyEnv: '',
      accessTokenEnv: 'RELAY_ACCESS_TOKEN',
      userIdEnv: 'RELAY_USER_ID',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }

    await expect(readConfiguredExternalUsage(
      [query],
      'https://other.example.com/v1',
      { RELAY_ACCESS_TOKEN: 'management-token', RELAY_USER_ID: '42' },
    )).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries Sub2API account balance with its JWT token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 0,
      message: 'success',
      data: { balance: 18.75 },
    })))
    vi.stubGlobal('fetch', fetchMock)

    const usage = await readConfiguredExternalUsage([{
      enabled: true,
      origin: 'https://sub2.example.com',
      template: 'sub2Api',
      apiKeyEnv: '',
      accessTokenEnv: 'SUB2_JWT',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://sub2.example.com/v1/responses', { SUB2_JWT: 'jwt-token' })
    expect(usage).toMatchObject({ balanceLabel: '$18.75' })
    expect(fetchMock).toHaveBeenCalledWith('https://sub2.example.com/api/v1/auth/me', expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer jwt-token',
      }),
    }))
  })

  it('uses the CC Switch general balance protocol and reuses OPENAI_API_KEY', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      balance: 9.75,
      is_active: true,
    })))
    vi.stubGlobal('fetch', fetchMock)

    const usage = await readConfiguredExternalUsage([{
      enabled: true,
      origin: 'https://general.example.com',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://general.example.com/v1/responses', { OPENAI_API_KEY: 'sk-query' })

    expect(usage).toMatchObject({ balanceLabel: '$9.75' })
    expect(fetchMock).toHaveBeenCalledWith('https://general.example.com/user/balance', expect.objectContaining({
      headers: expect.objectContaining({
        'Authorization': 'Bearer sk-query',
        'User-Agent': expect.stringMatching(/^codex-hud\/\d+\.\d+\.\d+/),
      }),
    }))
  })

  it('refreshes cached usage in the background and merges concurrent requests', async () => {
    let resolveResponse: ((response: Response) => void) | undefined
    const fetchMock = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)
    const query = [{
      enabled: true,
      origin: 'https://background.example.com',
      template: 'general' as const,
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }]
    const endpoint = 'https://background.example.com/v1/responses'
    const updated = vi.fn()
    expect(readCachedConfiguredExternalUsage(query, endpoint, { OPENAI_API_KEY: 'key' }, updated, 1_000)).toBeNull()
    expect(readCachedConfiguredExternalUsage(query, endpoint, { OPENAI_API_KEY: 'key' }, updated, 1_001)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveResponse?.(new Response(JSON.stringify({ balance: 6 })))
    await vi.waitFor(() => expect(updated).toHaveBeenCalledTimes(1))
    expect(readCachedConfiguredExternalUsage(query, endpoint, { OPENAI_API_KEY: 'key' }, updated, 1_002)).toMatchObject({ balanceLabel: '$6' })
  })

  it('does not fall back to the inference key when a dedicated key is configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(readConfiguredExternalUsage([{
      enabled: true,
      origin: 'https://dedicated-missing.example.com',
      template: 'general',
      apiKeyEnv: 'BALANCE_API_KEY',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://dedicated-missing.example.com/v1/responses', {
      OPENAI_API_KEY: 'sk-inference',
    })).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('separates cached balances when credentials or users change', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 3 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 8 })))
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      enabled: true,
      origin: 'https://cache-isolated.example.com',
      template: 'general' as const,
      apiKeyEnv: 'BALANCE_API_KEY',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }
    const endpoint = 'https://cache-isolated.example.com/v1/responses'
    await expect(readConfiguredExternalUsage([query], endpoint, { BALANCE_API_KEY: 'first' }, 1_000)).resolves.toMatchObject({ balanceLabel: '$3' })
    await expect(readConfiguredExternalUsage([query], endpoint, { BALANCE_API_KEY: 'second' }, 1_001)).resolves.toMatchObject({ balanceLabel: '$8' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('drops a cached balance after the stale grace period', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ balance: 3 })))
      .mockRejectedValueOnce(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      enabled: true,
      origin: 'https://stale-limit.example.com',
      template: 'general' as const,
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 1_000,
      quotaPerCredit: 500_000,
    }
    const endpoint = 'https://stale-limit.example.com/v1/responses'
    await expect(readConfiguredExternalUsage([query], endpoint, { OPENAI_API_KEY: 'key' }, 1_000)).resolves.toMatchObject({ balanceLabel: '$3' })
    await expect(readConfiguredExternalUsage([query], endpoint, { OPENAI_API_KEY: 'key' }, 901_001)).resolves.toBeNull()
  })

  it('ignores oversized response bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x'.repeat(65 * 1024)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(readConfiguredExternalUsage([{
      enabled: true,
      origin: 'https://oversized.example.com',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://oversized.example.com/v1/responses', { OPENAI_API_KEY: 'key' })).resolves.toBeNull()
  })

  it('falls back to a CC Switch-style usage endpoint and formats its fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<!doctype html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        isValid: true,
        planName: 'AI system',
        remaining: 933.07,
        unit: 'USD',
      }), { headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const usage = await readConfiguredExternalUsage([{
      enabled: true,
      origin: '*',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://relay.example.com/v1/responses', { OPENAI_API_KEY: 'sk-query' })

    expect(usage).toMatchObject({ balanceLabel: 'AI system: $933.07' })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://relay.example.com/user/balance', expect.any(Object))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://relay.example.com/v1/usage', expect.any(Object))
  })

  it('does not send a general-query credential outside the session origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ remaining: 1 }), {
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await readConfiguredExternalUsage([{
      enabled: true,
      origin: '*',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://same-origin.example.com/v1/responses?redirect=https://evil.example', { OPENAI_API_KEY: 'sk-query' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://same-origin.example.com/user/balance', expect.any(Object))
  })

  it('ignores usage responses that explicitly mark the account invalid', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      isValid: false,
      remaining: 100,
      unit: 'USD',
    })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      readConfiguredExternalUsage([{
        enabled: true,
        origin: '*',
        template: 'general',
        apiKeyEnv: '',
        accessTokenEnv: '',
        userIdEnv: '',
        refreshMs: 300_000,
        quotaPerCredit: 500_000,
      }], 'https://invalid-account.example.com/v1/responses', { OPENAI_API_KEY: 'sk-query' }),
    ).resolves.toBeNull()
  })

  it('prefers a dedicated general-query API key environment variable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ balance: 7 })))
    vi.stubGlobal('fetch', fetchMock)

    await readConfiguredExternalUsage([{
      enabled: true,
      origin: 'https://dedicated.example.com',
      template: 'general',
      apiKeyEnv: 'BALANCE_API_KEY',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://dedicated.example.com/v1', {
      BALANCE_API_KEY: 'sk-dedicated',
      OPENAI_API_KEY: 'sk-inference',
    })

    expect(fetchMock).toHaveBeenCalledWith('https://dedicated.example.com/user/balance', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer sk-dedicated' }),
    }))
  })

  it('applies the default general template to the current third-party origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ balance: 4.5 })))
    vi.stubGlobal('fetch', fetchMock)

    const usage = await readConfiguredExternalUsage([{
      enabled: true,
      origin: '*',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'https://auto-relay.example.com/v1/responses', { OPENAI_API_KEY: 'sk-auto' })

    expect(usage).toMatchObject({ balanceLabel: '$4.5' })
    expect(fetchMock).toHaveBeenCalledWith('https://auto-relay.example.com/user/balance', expect.any(Object))
  })

  it('never applies the default general template to official endpoints', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const query = {
      enabled: true,
      origin: '*',
      template: 'general' as const,
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }

    await expect(readConfiguredExternalUsage(
      [query],
      'https://chatgpt.com/backend-api/codex/responses',
      { OPENAI_API_KEY: 'sk-never-send' },
    )).resolves.toBeNull()
    await expect(readConfiguredExternalUsage(
      [query],
      'https://api.openai.com/v1/responses',
      { OPENAI_API_KEY: 'sk-never-send' },
    )).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never sends relay credentials over cleartext HTTP outside loopback', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const query = [{
      enabled: true,
      origin: '*',
      template: 'general' as const,
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }]

    await expect(readConfiguredExternalUsage(
      query,
      'http://relay.example.com/v1/responses',
      { OPENAI_API_KEY: 'sk-never-send' },
    )).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows a cleartext general query for an explicit loopback development endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ balance: 2 })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(readConfiguredExternalUsage([{
      enabled: true,
      origin: '*',
      template: 'general',
      apiKeyEnv: '',
      accessTokenEnv: '',
      userIdEnv: '',
      refreshMs: 300_000,
      quotaPerCredit: 500_000,
    }], 'http://127.0.0.1:8787/v1/responses', { OPENAI_API_KEY: 'sk-local' })).resolves.toMatchObject({
      balanceLabel: '$2',
    })
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8787/user/balance', expect.any(Object))
  })
})
