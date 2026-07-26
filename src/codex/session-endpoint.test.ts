import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findCodexLogDatabase, resolveProcessEndpoint, resolveSessionEndpoint } from './session-endpoint.js'

const directories: string[] = []
let clock = 1_000_000

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

interface LogRow {
  ts: number
  tsNanos?: number
  processUuid: string
  threadId: string | null
  target: string
  body: string
}

function codexHomeWithLogs(rows: LogRow[], databaseName = 'logs_2.sqlite'): string {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-endpoint-'))
  directories.push(codexHome)
  const values = rows.map((row, index) => [
    index + 1,
    row.ts,
    row.tsNanos ?? 0,
    `'${row.processUuid}'`,
    row.threadId === null ? 'NULL' : `'${row.threadId}'`,
    `'${row.target}'`,
    `'${row.body.replaceAll('\'', '\'\'')}'`,
  ].join(', '))
  execFileSync('sqlite3', [path.join(codexHome, databaseName), [
    'CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, process_uuid TEXT, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
    ...values.map(value => `INSERT INTO logs VALUES (${value});`),
  ].join('\n')])
  return codexHome
}

function request(ts: number, threadId: string, url: string): LogRow {
  return {
    ts,
    tsNanos: 0,
    processUuid: 'pid:1:uuid',
    threadId,
    target: 'codex_http_client::default_client',
    body: `Request completed method=POST url=${url} status=200 OK headers={"date": "Sun"}`,
  }
}

function init(ts: number, processUuid: string, baseUrl: string): LogRow {
  return {
    ts,
    processUuid,
    threadId: null,
    target: 'codex_core::session::session',
    body: `session_init: Configuring session: model=gpt-5; provider=ModelProviderInfo { name: "custom", base_url: Some("${baseUrl}"), env_key: None }`,
  }
}

/** Every call needs a fresh timestamp because results are cached for 30s. */
function resolve(codexHome: string, sessionId: string) {
  clock += 60_000
  return resolveSessionEndpoint(sessionId, { CODEX_HOME: codexHome }, clock)
}

describe('session endpoint resolution', () => {
  it('reports the most recent request URL for the session', () => {
    const codexHome = codexHomeWithLogs([
      request(30, 'thread-a', 'https://newest.example.com/v1/responses'),
      request(20, 'thread-a', 'https://older.example.com/v1/responses'),
      request(40, 'thread-a', 'https://newer.example.com/v1/responses'),
    ])
    // Insertion order must not decide the answer; the newest timestamp does.
    expect(resolve(codexHome, 'thread-a')).toEqual({
      url: 'https://newer.example.com/v1/responses',
      source: 'log-request',
    })
  })

  it('breaks ties within one second by insertion order', () => {
    const codexHome = codexHomeWithLogs([
      request(10, 'thread-a', 'https://first.example.com/v1/responses'),
      request(10, 'thread-a', 'https://second.example.com/v1/responses'),
    ])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://second.example.com/v1/responses')
  })

  it('ignores another session sharing the log database', () => {
    const codexHome = codexHomeWithLogs([
      request(10, 'thread-a', 'https://mine.example.com/v1/responses'),
      request(30, 'thread-b', 'https://theirs.example.com/v1/responses'),
    ])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://mine.example.com/v1/responses')
  })

  it('falls back to the provider Codex resolved for the session', () => {
    const codexHome = codexHomeWithLogs([
      init(10, 'pid:1:uuid', 'https://resolved.example.com/v1'),
      { ts: 20, processUuid: 'pid:1:uuid', threadId: 'thread-a', target: 'codex_core::session::session', body: 'session_configured' },
    ])
    expect(resolve(codexHome, 'thread-a')).toEqual({
      url: 'https://resolved.example.com/v1',
      source: 'log-init',
    })
  })

  it('does not adopt an init row written after the session began', () => {
    const codexHome = codexHomeWithLogs([
      init(10, 'pid:1:uuid', 'https://mine.example.com/v1'),
      { ts: 20, processUuid: 'pid:1:uuid', threadId: 'thread-a', target: 'codex_core::session::session', body: 'session_configured' },
      // Same Codex process, later session, endpoint swapped in between.
      init(30, 'pid:1:uuid', 'https://later.example.com/v1'),
    ])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://mine.example.com/v1')
  })

  it('ignores a thread-tagged row that merely mentions a provider', () => {
    const codexHome = codexHomeWithLogs([
      init(5, 'pid:1:uuid', 'https://mine.example.com/v1'),
      { ...init(10, 'pid:1:uuid', 'https://mentioned.example.com/v1'), threadId: 'thread-a' },
      { ts: 20, processUuid: 'pid:1:uuid', threadId: 'thread-a', target: 'codex_core::session::session', body: 'session_configured' },
    ])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://mine.example.com/v1')
  })

  it('keeps the accurate answer when the fallback query cannot run', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-endpoint-schema-'))
    directories.push(codexHome)
    // A future Codex schema without process_uuid breaks only the second query.
    execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), [
      'CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
      `INSERT INTO logs VALUES (1, 10, 'thread-a', 'codex_http_client::default_client', 'Request completed method=POST url=https://mine.example.com/v1/responses status=200 OK');`,
    ].join('\n')])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://mine.example.com/v1/responses')
  })

  it('ignores an init row belonging to a different Codex process', () => {
    const codexHome = codexHomeWithLogs([
      init(10, 'pid:2:other', 'https://other.example.com/v1'),
      { ts: 20, processUuid: 'pid:1:uuid', threadId: 'thread-a', target: 'codex_core::session::session', body: 'session_configured' },
    ])
    expect(resolve(codexHome, 'thread-a')).toBeNull()
  })

  it('returns nothing for a session the log database has never seen', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://mine.example.com/v1/responses')])
    expect(resolve(codexHome, 'thread-missing')).toBeNull()
  })

  it('rejects a session id that is not an identifier', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://mine.example.com/v1/responses')])
    expect(resolve(codexHome, 'thread-a\' OR \'1\'=\'1')).toBeNull()
  })

  it('serves a repeated lookup from cache instead of querying again', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://mine.example.com/v1/responses')])
    const first = resolve(codexHome, 'thread-a')
    fs.rmSync(path.join(codexHome, 'logs_2.sqlite'))
    expect(resolveSessionEndpoint('thread-a', { CODEX_HOME: codexHome }, clock + 1_000)).toEqual(first)
    expect(resolveSessionEndpoint('thread-a', { CODEX_HOME: codexHome }, clock + 60_000)).toBeNull()
  })

  it('prefers the newest log schema and skips non-files', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://old.example.com/v1/responses')], 'logs_9.sqlite')
    fs.writeFileSync(path.join(codexHome, 'logs.sqlite'), '')
    fs.mkdirSync(path.join(codexHome, 'logs_10.sqlite'))
    expect(findCodexLogDatabase(codexHome)).toBe(path.join(codexHome, 'logs_9.sqlite'))
  })

  it('resolves a Codex process that has not created a session yet', () => {
    const codexHome = codexHomeWithLogs([init(2_000, `pid:${process.pid}:uuid`, 'https://mine.example.com/v1')])
    clock += 60_000
    expect(resolveProcessEndpoint(process.pid, new Date(1_000_000), { CODEX_HOME: codexHome }, clock)).toEqual({
      url: 'https://mine.example.com/v1',
      source: 'log-init',
    })
  })

  it('ignores a process launched before this HUD pane', () => {
    const codexHome = codexHomeWithLogs([init(2_000, `pid:${process.pid}:uuid`, 'https://stale.example.com/v1')])
    clock += 60_000
    // The row predates the launch, so it belongs to an earlier Codex run.
    expect(resolveProcessEndpoint(process.pid, new Date(9_000_000), { CODEX_HOME: codexHome }, clock)).toBeNull()
  })

  it('ignores another Codex process in the same log database', () => {
    const codexHome = codexHomeWithLogs([init(2_000, 'pid:999999:uuid', 'https://theirs.example.com/v1')])
    clock += 60_000
    expect(resolveProcessEndpoint(process.pid, new Date(1_000_000), { CODEX_HOME: codexHome }, clock)).toBeNull()
  })

  it('rejects a process id that is not a positive integer', () => {
    const codexHome = codexHomeWithLogs([init(2_000, 'pid:0:uuid', 'https://mine.example.com/v1')])
    clock += 60_000
    expect(resolveProcessEndpoint(0, new Date(1_000_000), { CODEX_HOME: codexHome }, clock)).toBeNull()
  })

  it('returns nothing when the Codex home holds no log database', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-endpoint-empty-'))
    directories.push(codexHome)
    expect(findCodexLogDatabase(codexHome)).toBeNull()
    expect(resolve(codexHome, 'thread-a')).toBeNull()
  })
})
