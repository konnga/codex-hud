import type { SessionInfo } from '../types/state.js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectAuthInfo, collectSessionTitle } from './session-metadata.js'

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
