import type { SessionInfo } from '../types/state.js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readConfiguredExternalUsage } from '../codex/external-usage.js'
import { configuredProviderCredential, readActiveProviderConfig } from '../codex/provider-credentials.js'
import { evaluateUsageTrust } from '../codex/rate-limits.js'
import { clearEndpointCaches, resolveSessionEndpoint } from '../codex/session-endpoint.js'
import { collectAuthInfo, hasTrustedOpenAiAuth } from './session-metadata.js'

const START = Date.parse('2026-09-13T12:00:00Z')
const directories: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START + 5_000)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  clearEndpointCaches()
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

function home(): NodeJS.ProcessEnv {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-switch-'))
  directories.push(directory)
  return { CODEX_HOME: directory }
}

function session(id = 'api-session', startedAt = START, modelProvider = 'custom'): SessionInfo {
  return { id, startTime: new Date(startedAt), modelProvider, rolloutPath: '/tmp/rollout.jsonl', cwd: '/tmp' }
}

function writeConfig(env: NodeJS.ProcessEnv, lines: string[], modifiedAt = START - 1_000): void {
  const file = path.join(env.CODEX_HOME!, 'config.toml')
  fs.writeFileSync(file, lines.join('\n'))
  fs.utimesSync(file, modifiedAt / 1_000, modifiedAt / 1_000)
}

function writeRelay(env: NodeJS.ProcessEnv, host = 'old-relay.test', modifiedAt = START - 1_000, credential = 'experimental_bearer_token = "sk-inline-secret"'): void {
  writeConfig(env, [
    'model_provider = "custom"',
    '[model_providers.custom]',
    `base_url = "https://${host}/v1"`,
    credential,
  ], modifiedAt)
}

function writeChatGptAuth(env: NodeJS.ProcessEnv): void {
  fs.writeFileSync(path.join(env.CODEX_HOME!, 'auth.json'), JSON.stringify({
    tokens: { access_token: 'chatgpt-access-token', refresh_token: 'chatgpt-refresh-token' },
  }))
}

function writeRequests(env: NodeJS.ProcessEnv, rows: Array<{ id: string, url: string }>): void {
  execFileSync('sqlite3', [path.join(env.CODEX_HOME!, 'logs_2.sqlite'), [
    'CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, ts INTEGER, process_uuid TEXT, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
    'DELETE FROM logs;',
    ...rows.map((row, index) => `INSERT INTO logs VALUES (${index + 1}, 1, 'pid:1:uuid', '${row.id}', 'codex_http_client::client', 'Request completed method=POST url=${row.url} status=200 OK');`),
  ].join('\n')])
  clearEndpointCaches()
}

describe('authentication display across provider switches', () => {
  it.each([false, true])('keeps the inline-key session identity after switching config (request logs: %s)', (logged) => {
    const env = home()
    const current = session()
    writeRelay(env)
    if (logged) {
      writeRequests(env, [{ id: current.id, url: 'https://old-relay.test/v1/responses' }])
    }
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })

    writeRelay(env, 'new-relay.test', START + 1_000)
    expect(readActiveProviderConfig(current, env)).toBeNull()
    expect(configuredProviderCredential(current, env)).toBeNull()
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })

    // The result must outlive the ordinary 30-second render cache.
    vi.setSystemTime(START + 65_000)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    expect(hasTrustedOpenAiAuth(current, env)).toBe(false)
  })

  it('keeps the label when an unrelated edit only changes config mtime', () => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeRelay(env, 'old-relay.test', START + 1_000)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
  })

  it('retains an env_key identity without retaining or reusing the credential', () => {
    const env: NodeJS.ProcessEnv = { ...home(), RELAY_API_KEY: 'sk-env-secret' }
    const current = session()
    writeRelay(env, 'old-relay.test', START - 1_000, 'env_key = "RELAY_API_KEY"')
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeRelay(env, 'new-relay.test', START + 1_000)
    delete env.RELAY_API_KEY
    expect(configuredProviderCredential(current, env)).toBeNull()
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
  })

  it('uses newer endpoint evidence instead of the saved provider origin', () => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeRelay(env, 'new-relay.test', START + 1_000)
    writeRequests(env, [{ id: current.id, url: 'https://actual-relay.test/v1/responses' }])
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'actual-relay' })
  })

  it('does not invent API-key authentication from an endpoint or a rewritten config alone', () => {
    const env = home()
    const current = session()
    writeRelay(env, 'new-relay.test', START + 1_000)
    writeRequests(env, [{ id: current.id, url: 'https://old-relay.test/v1/responses' }])
    expect(collectAuthInfo(null, current, env)).toBeNull()
  })

  it('isolates identities by session, Codex home, start time and provider', () => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeRelay(env, 'new-relay.test', START + 1_000)
    expect(collectAuthInfo(null, session('unobserved-session'), env)).toBeNull()
    expect(collectAuthInfo(null, null, env)).toBeNull()
    expect(collectAuthInfo(null, current, home())).toBeNull()
    expect(collectAuthInfo(null, session(current.id, START - 5_000), env)).toBeNull()
    expect(collectAuthInfo(null, session(current.id, START, 'openai'), env)).toBeNull()

    const newer = session('new-session', START + 2_000)
    expect(collectAuthInfo(null, newer, env)).toEqual({ method: 'new-relay' })
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
  })

  it('does not mistake an old relay for ChatGPT after switching global config to subscription login', () => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeConfig(env, ['model_provider = "openai"'], START + 1_000)
    writeChatGptAuth(env)

    const official = session('official-session', START + 2_000, 'openai')
    writeRequests(env, [{ id: official.id, url: 'https://chatgpt.com/backend-api/codex/responses' }])
    expect(collectAuthInfo('pro', official, env)).toEqual({ method: 'ChatGPT pro', user: undefined })
    expect(collectAuthInfo(null, official, env)).toEqual({ method: 'ChatGPT', user: undefined })
    expect(hasTrustedOpenAiAuth(official, env)).toBe(true)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    // A relay's claimed plan must not replace the API-key identity either.
    expect(collectAuthInfo('team', current, env)).toEqual({ method: 'old-relay' })
    expect(hasTrustedOpenAiAuth(current, env)).toBe(false)
  })

  it('keeps the official session plan and quota trust when a new relay session starts', () => {
    const env = home()
    const official = session('official-session', START, 'openai')
    writeConfig(env, ['model_provider = "openai"'])
    writeChatGptAuth(env)
    writeRequests(env, [{ id: official.id, url: 'https://chatgpt.com/backend-api/codex/responses' }])
    expect(collectAuthInfo('pro', official, env)).toEqual({ method: 'ChatGPT pro', user: undefined })
    expect(hasTrustedOpenAiAuth(official, env)).toBe(true)

    writeRelay(env, 'new-relay.test', START + 1_000)
    const relay = session('relay-session', START + 2_000)
    expect(collectAuthInfo('team', relay, env)).toEqual({ method: 'new-relay' })
    vi.setSystemTime(START + 65_000)
    expect(collectAuthInfo('pro', official, env)).toEqual({ method: 'ChatGPT pro', user: undefined })
    expect(evaluateUsageTrust(resolveSessionEndpoint(official.id, env)?.url ?? null, hasTrustedOpenAiAuth(official, env)))
      .toMatchObject({ trusted: true, reason: 'official-endpoint' })
    expect(evaluateUsageTrust('https://new-relay.test', hasTrustedOpenAiAuth(relay, env)))
      .toMatchObject({ trusted: false, reason: 'untrusted-endpoint' })
  })

  it.each([null, 'pro'])('lets an observed ChatGPT endpoint supersede saved API identity (plan: %s)', (planType) => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeConfig(env, ['model_provider = "openai"'], START + 1_000)
    writeChatGptAuth(env)
    writeRequests(env, [{ id: current.id, url: 'https://chatgpt.com/backend-api/codex/responses' }])
    expect(collectAuthInfo(planType, current, env)).toEqual({ method: planType ? 'ChatGPT pro' : 'ChatGPT', user: undefined })
  })

  it('keeps only a display origin in memory when the original config disappears', () => {
    const env = home()
    const current = session()
    writeRelay(env, 'user:sk-url-secret@old-relay.test')
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    fs.unlinkSync(path.join(env.CODEX_HOME!, 'config.toml'))
    const info = collectAuthInfo(null, current, env)
    expect(info).toEqual({ method: 'old-relay' })
    expect(JSON.stringify(info)).not.toMatch(/sk-url-secret|sk-inline-secret/)
    expect(fs.readdirSync(env.CODEX_HOME!)).toEqual([])
    expect(configuredProviderCredential(current, env)).toBeNull()
  })

  it('preserves the official plan and user when an unrelated API key remains in the environment', () => {
    const env: NodeJS.ProcessEnv = { ...home(), OPENAI_API_KEY: 'sk-stale-key' }
    const official = session('official-session', START, 'openai')
    writeConfig(env, ['model_provider = "openai"'])
    fs.writeFileSync(path.join(env.CODEX_HOME!, 'auth.json'), JSON.stringify({
      tokens: { access_token: 'chatgpt-access-token' },
      email: 'subscriber@example.test',
    }))
    writeRequests(env, [{ id: official.id, url: 'https://chatgpt.com/backend-api/codex/responses' }])
    expect(collectAuthInfo('pro', official, env)).toEqual({ method: 'ChatGPT pro', user: 'subscriber' })
    writeRelay(env, 'new-relay.test', START + 1_000)
    vi.setSystemTime(START + 65_000)
    expect(collectAuthInfo('pro', official, env)).toEqual({ method: 'ChatGPT pro', user: 'subscriber' })
  })

  it('does not use display identity or a replacement key to query the old relay', async () => {
    const env = home()
    const current = session()
    writeRelay(env)
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    writeRelay(env, 'new-relay.test', START + 1_000, 'experimental_bearer_token = "sk-replacement-secret"')
    expect(collectAuthInfo(null, current, env)).toEqual({ method: 'old-relay' })
    const fetchMock = vi.fn()
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
    }], 'https://old-relay.test/v1/responses', env, Date.now(), current)).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(configuredProviderCredential(current, env)).toBeNull()
  })
})
