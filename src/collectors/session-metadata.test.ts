import type { SessionInfo } from '../types/state.js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAuthInfo, collectSessionTitle, hasTrustedOpenAiAuth } from './session-metadata.js'

const SESSION_START = Date.parse('2026-07-20T00:00:00Z')
const directories: string[] = []

interface LogRow {
  threadId: string | null
  processUuid?: string
  target: string
  body: string
  ts?: number
}

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

function apiKeyHome(prefix: string): string {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  directories.push(codexHome)
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-secret-value' }))
  return codexHome
}

/** A Codex home with no auth.json at all, as a custom provider leaves it. */
function bareHome(prefix: string): string {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  directories.push(codexHome)
  return codexHome
}

/** Writes config.toml and stamps its mtime relative to SESSION_START. */
function writeConfig(codexHome: string, baseUrl: string, mtimeOffsetMs: number): void {
  const configPath = path.join(codexHome, 'config.toml')
  fs.writeFileSync(configPath, [
    'model_provider = "custom"',
    '[model_providers.custom]',
    `base_url = "${baseUrl}"`,
  ].join('\n'))
  const seconds = (SESSION_START + mtimeOffsetMs) / 1_000
  fs.utimesSync(configPath, seconds, seconds)
}

/**
 * Writes the provider shape CC Switch uses: the credential lives inline in
 * config.toml, so nothing is ever written to auth.json.
 */
function writeConfigLines(codexHome: string, lines: string[], mtimeOffsetMs = -1_000): void {
  const configPath = path.join(codexHome, 'config.toml')
  fs.writeFileSync(configPath, lines.join('\n'))
  const seconds = (SESSION_START + mtimeOffsetMs) / 1_000
  fs.utimesSync(configPath, seconds, seconds)
}

function writeLogDatabase(codexHome: string, rows: LogRow[]): void {
  const values = rows.map((row, index) => [
    index + 1,
    row.ts ?? index + 1,
    0,
    `'${row.processUuid ?? 'pid:1:uuid'}'`,
    row.threadId === null ? 'NULL' : `'${row.threadId}'`,
    `'${row.target}'`,
    `'${row.body.replaceAll('\'', '\'\'')}'`,
  ].join(', '))
  execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), [
    'CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, process_uuid TEXT, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
    ...values.map(value => `INSERT INTO logs VALUES (${value});`),
  ].join('\n')])
}

function session(id: string): SessionInfo {
  return { id, rolloutPath: '/tmp/rollout.jsonl', startTime: new Date(SESSION_START), cwd: '/tmp' }
}

describe('session metadata collectors', () => {
  it('reports API-key auth without exposing the key', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-secret-value' }))
    expect(collectAuthInfo(null, null, { CODEX_HOME: codexHome })).toEqual({ method: 'API Key' })
  })

  it('shows the configured provider host when config.toml predates the session', () => {
    const codexHome = apiKeyHome('codex-hud-auth-host-')
    writeConfig(codexHome, 'https://anyrouter.top/v1', -1_000)
    expect(collectAuthInfo(null, session('session-config'), { CODEX_HOME: codexHome })).toEqual({ method: 'anyrouter' })
  })

  it('stays generic when config.toml was rewritten after the session started', () => {
    const codexHome = apiKeyHome('codex-hud-auth-stale-')
    writeConfig(codexHome, 'https://anyrouter.top/v1', 1_000)
    expect(collectAuthInfo(null, session('session-stale'), { CODEX_HOME: codexHome })).toEqual({ method: 'API Key' })
  })

  it('prefers the endpoint the session actually reached over config.toml', () => {
    const codexHome = apiKeyHome('codex-hud-auth-log-')
    writeConfig(codexHome, 'https://anyrouter.top/v1', -1_000)
    writeLogDatabase(codexHome, [
      { threadId: 'session-log', target: 'codex_http_client::default_client', body: 'Request completed method=POST url=https://api.aisz.mom/v1/responses status=200 OK' },
    ])
    expect(collectAuthInfo(null, session('session-log'), { CODEX_HOME: codexHome })).toEqual({ method: 'aisz' })
  })

  it('does not let a relayed plan type override API-key authentication', () => {
    const codexHome = apiKeyHome('codex-hud-auth-plan-')
    writeLogDatabase(codexHome, [
      { threadId: 'session-plan', target: 'codex_http_client::client', body: 'Request completed method=POST url=https://relay.example.com/v1/responses status=200 OK' },
    ])

    expect(collectAuthInfo('team', session('session-plan'), { CODEX_HOME: codexHome })).toEqual({ method: 'example' })
  })

  it('shows the subscription plan for ChatGPT authentication', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-chatgpt-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
      tokens: { access_token: 'not-a-jwt', refresh_token: 'secret' },
    }))

    expect(collectAuthInfo('team', session('session-chatgpt'), { CODEX_HOME: codexHome })).toEqual({
      method: 'ChatGPT team',
    })
  })

  it('trusts an unchanged provider that explicitly uses OpenAI authentication', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-openai-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
      tokens: { access_token: 'not-a-jwt' },
    }))
    const configPath = path.join(codexHome, 'config.toml')
    fs.writeFileSync(configPath, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'requires_openai_auth = true',
    ].join('\n'))
    const seconds = (SESSION_START - 1_000) / 1_000
    fs.utimesSync(configPath, seconds, seconds)
    const current = { ...session('session-openai-auth'), modelProvider: 'custom' }

    expect(hasTrustedOpenAiAuth(current, { CODEX_HOME: codexHome })).toBe(true)
  })

  it('does not trust OpenAI auth when a custom provider routes it to another origin', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-relayed-openai-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ tokens: { access_token: 'token' } }))
    const configPath = path.join(codexHome, 'config.toml')
    fs.writeFileSync(configPath, [
      '[model_providers.custom]',
      'requires_openai_auth = true',
      'base_url = "https://relay.example.com/v1"',
    ].join('\n'))
    const seconds = (SESSION_START - 1_000) / 1_000
    fs.utimesSync(configPath, seconds, seconds)

    expect(hasTrustedOpenAiAuth(
      { ...session('session-relay-auth'), modelProvider: 'custom' },
      { CODEX_HOME: codexHome },
    )).toBe(false)
  })

  it('does not trust a custom relay provider named openai when endpoint logs are missing', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-openai-relay-name-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ tokens: { access_token: 'token' } }))
    const configPath = path.join(codexHome, 'config.toml')
    fs.writeFileSync(configPath, [
      'model_provider = "openai"',
      '[model_providers.openai]',
      'requires_openai_auth = true',
      'base_url = "https://relay.example.com/v1"',
    ].join('\n'))
    const seconds = (SESSION_START - 1_000) / 1_000
    fs.utimesSync(configPath, seconds, seconds)

    expect(hasTrustedOpenAiAuth(
      { ...session('session-openai-relay-name'), modelProvider: 'openai' },
      { CODEX_HOME: codexHome },
    )).toBe(false)
  })

  it('does not treat an arbitrary nonempty auth file as ChatGPT authentication', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-auth-incomplete-'))
    directories.push(codexHome)
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ last_refresh: '2026-07-20' }))

    expect(hasTrustedOpenAiAuth(
      { ...session('session-incomplete-auth'), modelProvider: 'openai' },
      { CODEX_HOME: codexHome },
    )).toBe(false)
  })

  it('prefers an actual ChatGPT endpoint when an API key remains in the environment', () => {
    const codexHome = apiKeyHome('codex-hud-auth-chatgpt-endpoint-')
    writeLogDatabase(codexHome, [
      { threadId: 'session-chatgpt-endpoint', target: 'codex_http_client::client', body: 'Request completed method=POST url=https://chatgpt.com/backend-api/codex/responses status=200 OK' },
    ])

    expect(collectAuthInfo('pro', session('session-chatgpt-endpoint'), {
      CODEX_HOME: codexHome,
      OPENAI_API_KEY: 'sk-stale',
    })).toEqual({ method: 'ChatGPT pro' })
  })

  it('falls back to the provider Codex resolved when no request has completed', () => {
    const codexHome = apiKeyHome('codex-hud-auth-init-')
    writeLogDatabase(codexHome, [
      { ts: 10, threadId: null, processUuid: 'pid:7:uuid', target: 'codex_core::session::session', body: 'session_init: Configuring session: provider=ModelProviderInfo { name: "custom", base_url: Some("https://jianzhile.vip/v1"), env_key: None }' },
      { ts: 20, threadId: 'session-init', processUuid: 'pid:7:uuid', target: 'codex_core::session::session', body: 'session_configured' },
    ])
    expect(collectAuthInfo(null, session('session-init'), { CODEX_HOME: codexHome })).toEqual({ method: 'jianzhile' })
  })

  it('reports plain API-key auth when no source can prove an endpoint', () => {
    const codexHome = apiKeyHome('codex-hud-auth-unknown-')
    expect(collectAuthInfo(null, session('session-unknown'), { CODEX_HOME: codexHome })).toEqual({ method: 'API Key' })
  })

  it('does not borrow the configured provider before a session is bound', () => {
    const codexHome = apiKeyHome('codex-hud-auth-unbound-')
    writeConfig(codexHome, 'https://anyrouter.top/v1', -1_000)
    // The HUD renders during Codex startup; config.toml belongs to no session yet.
    expect(collectAuthInfo(null, null, { CODEX_HOME: codexHome })).toEqual({ method: 'API Key' })
  })

  it('keeps a multi-part public suffix out of the provider label', () => {
    const codexHome = apiKeyHome('codex-hud-auth-suffix-')
    writeConfig(codexHome, 'https://api.relay.com.cn/v1', -1_000)
    expect(collectAuthInfo(null, session('session-suffix'), { CODEX_HOME: codexHome })).toEqual({ method: 'relay' })
  })

  it('names the relay for a provider that keeps its key inline in config.toml', () => {
    // CC Switch stores the API key as an inline bearer token, so auth.json is
    // absent and OPENAI_API_KEY never enters the HUD's environment.
    const codexHome = bareHome('codex-hud-auth-inline-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'wire_api = "responses"',
      'requires_openai_auth = false',
      'base_url = "https://anyrouter.top/v1"',
      'experimental_bearer_token = "sk-inline-secret"',
    ])
    expect(collectAuthInfo(null, session('session-inline'), { CODEX_HOME: codexHome })).toEqual({ method: 'anyrouter' })
  })

  it('never renders the inline credential itself', () => {
    const codexHome = bareHome('codex-hud-auth-inline-secret-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://anyrouter.top/v1"',
      'experimental_bearer_token = "sk-inline-secret"',
    ])
    const info = collectAuthInfo(null, session('session-inline-secret'), { CODEX_HOME: codexHome })
    expect(JSON.stringify(info)).not.toContain('sk-inline-secret')
  })

  it('reads the credential an env_key points at', () => {
    const codexHome = bareHome('codex-hud-auth-envkey-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://anyrouter.top/v1"',
      'env_key = "RELAY_API_KEY"',
    ])
    expect(collectAuthInfo(null, session('session-envkey'), {
      CODEX_HOME: codexHome,
      RELAY_API_KEY: 'sk-env-secret',
    })).toEqual({ method: 'anyrouter' })
  })

  it('stays unauthenticated when an env_key names an unset variable', () => {
    const codexHome = bareHome('codex-hud-auth-envkey-missing-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://anyrouter.top/v1"',
      'env_key = "RELAY_API_KEY"',
    ])
    expect(collectAuthInfo(null, session('session-envkey-missing'), { CODEX_HOME: codexHome })).toBeNull()
  })

  it('stays unauthenticated when a custom provider declares no credential', () => {
    const codexHome = bareHome('codex-hud-auth-nocred-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://anyrouter.top/v1"',
    ])
    expect(collectAuthInfo(null, session('session-nocred'), { CODEX_HOME: codexHome })).toBeNull()
  })

  it('does not borrow an inline credential before a session is bound', () => {
    const codexHome = bareHome('codex-hud-auth-inline-unbound-')
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://anyrouter.top/v1"',
      'experimental_bearer_token = "sk-inline-secret"',
    ])
    expect(collectAuthInfo(null, null, { CODEX_HOME: codexHome })).toBeNull()
  })

  it('does not trust an inline key as ChatGPT authentication', () => {
    const codexHome = bareHome('codex-hud-auth-inline-trust-')
    fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
      tokens: { access_token: 'not-a-jwt' },
    }))
    writeConfigLines(codexHome, [
      'model_provider = "custom"',
      '[model_providers.custom]',
      'requires_openai_auth = true',
      'base_url = "https://chatgpt.com/backend-api/codex"',
      'experimental_bearer_token = "sk-inline-secret"',
    ])
    expect(hasTrustedOpenAiAuth(
      { ...session('session-inline-trust'), modelProvider: 'custom' },
      { CODEX_HOME: codexHome },
    )).toBe(false)
  })

  it('reads a session title from the Codex state database when sqlite3 is available', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-title-'))
    directories.push(codexHome)
    const database = path.join(codexHome, 'state_5.sqlite')
    execFileSync('sqlite3', [database, 'CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, first_user_message TEXT NOT NULL); INSERT INTO threads VALUES (\'session-1\', \'Named session\', \'Original prompt\');'])
    expect(collectSessionTitle({
      id: 'session-1',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date(),
      cwd: '/tmp',
    }, { CODEX_HOME: codexHome })).toBe('Named session')
  })

  it('does not expose the default title when it is the first user message', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-title-'))
    directories.push(codexHome)
    const database = path.join(codexHome, 'state_5.sqlite')
    execFileSync('sqlite3', [database, 'CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, first_user_message TEXT NOT NULL); INSERT INTO threads VALUES (\'session-private\', \'Sensitive prompt\', \'Sensitive prompt\');'])
    expect(collectSessionTitle({
      id: 'session-private',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date(),
      cwd: '/tmp',
    }, { CODEX_HOME: codexHome })).toBeNull()
  })
})
