import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearEndpointCaches,
  findCodexLogDatabase,
  inspectCodexLogSchema,
  isOfficialOpenAIEndpoint,
  resolveProcessEndpoint,
  resolveProcessSession,
  resolveSessionEndpoint,
} from './session-endpoint.js'

const processSnapshot = vi.hoisted(() => ({ stdout: null as string | null, status: 0 }))
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    spawnSync: (...args: Parameters<typeof original.spawnSync>) => {
      if (args[0] === 'ps' && processSnapshot.stdout !== null) {
        return { stdout: processSnapshot.stdout, status: processSnapshot.status }
      }
      return original.spawnSync(...args)
    },
  }
})

const directories: string[] = []
let clock = 1_000_000

afterEach(() => {
  processSnapshot.stdout = null
  processSnapshot.status = 0
  clearEndpointCaches()
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

interface StateThread {
  id: string
  rolloutPath: string
  cwd: string
  threadSource?: string | null
  agentPath?: string | null
  createdAtMs?: number
  archived?: number
}

function addStateThreads(codexHome: string, threads: StateThread[]): void {
  const sqlValue = (value: string | null): string => value === null
    ? 'NULL'
    : `'${value.replaceAll('\'', '\'\'')}'`
  execFileSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), [
    'CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL, thread_source TEXT, agent_path TEXT, created_at INTEGER NOT NULL DEFAULT 0, created_at_ms INTEGER, archived INTEGER NOT NULL DEFAULT 0);',
    ...threads.map(thread => `INSERT INTO threads VALUES (${[
      sqlValue(thread.id),
      sqlValue(thread.rolloutPath),
      sqlValue(thread.cwd),
      sqlValue(thread.threadSource === undefined ? 'user' : thread.threadSource),
      sqlValue(thread.agentPath ?? null),
      Math.floor((thread.createdAtMs ?? 1) / 1000),
      thread.createdAtMs ?? 1,
      thread.archived ?? 0,
    ].join(', ')});`),
  ].join('\n')])
}

function installManagedDaemon(codexHome: string): void {
  fs.mkdirSync(path.join(codexHome, 'packages', 'app-server-daemon'), { recursive: true })
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
  it('recognizes only official OpenAI origins as subscription-limit authorities', () => {
    expect(isOfficialOpenAIEndpoint('https://chatgpt.com/backend-api/codex/responses')).toBe(true)
    expect(isOfficialOpenAIEndpoint('https://sub.chatgpt.com/codex')).toBe(true)
    expect(isOfficialOpenAIEndpoint('https://api.openai.com/v1/responses')).toBe(true)
    expect(isOfficialOpenAIEndpoint('https://agentrouter.org/v1/responses')).toBe(false)
    expect(isOfficialOpenAIEndpoint(null)).toBe(false)
  })

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

  it('reads request URLs from the current Codex client log target', () => {
    const codexHome = codexHomeWithLogs([
      { ...request(10, 'thread-client', 'https://current.example.com/v1/responses'), target: 'codex_http_client::client' },
    ])

    expect(resolve(codexHome, 'thread-client')?.url).toBe('https://current.example.com/v1/responses')
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
    expect(inspectCodexLogSchema(codexHome)).toMatchObject({
      endpointCompatible: false,
      rateLimitCompatible: false,
    })
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

  it('keeps the last confirmed endpoint when source logs are pruned', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://mine.example.com/v1/responses')])
    const first = resolve(codexHome, 'thread-a')
    expect(resolveSessionEndpoint('thread-a', { CODEX_HOME: codexHome }, clock + 1_000)).toEqual(first)
    execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), 'DELETE FROM logs;'])
    expect(resolveSessionEndpoint('thread-a', { CODEX_HOME: codexHome }, clock + 60_000)).toEqual(first)
  })

  it('restores the confirmed origin in a new HUD process after source logs are pruned', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-persisted', 'https://chatgpt.com/backend-api/codex/responses')])
    expect(resolve(codexHome, 'thread-persisted')).toMatchObject({
      url: 'https://chatgpt.com/backend-api/codex/responses',
      source: 'log-request',
    })
    execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), 'DELETE FROM logs;'])
    clearEndpointCaches()

    expect(resolve(codexHome, 'thread-persisted')).toEqual({
      url: 'https://chatgpt.com',
      source: 'persisted',
    })
    expect(fs.statSync(path.join(codexHome, 'codex-hud', 'session-endpoints', 'thread-persisted.json')).mode & 0o777).toBe(0o600)
  })

  it('replaces a cached endpoint when newer positive evidence exists', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://first.example.com/v1/responses')])
    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://first.example.com/v1/responses')
    execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), [
      'INSERT INTO logs VALUES (2, 20, 0, \'pid:1:uuid\', \'thread-a\', \'codex_http_client::default_client\',',
      '  \'Request completed method=POST url=https://second.example.com/v1/responses status=200 OK\');',
    ].join('\n')])

    expect(resolve(codexHome, 'thread-a')?.url).toBe('https://second.example.com/v1/responses')
  })

  it('prefers the newest log schema and skips non-files', () => {
    const codexHome = codexHomeWithLogs([request(10, 'thread-a', 'https://old.example.com/v1/responses')], 'logs_9.sqlite')
    fs.writeFileSync(path.join(codexHome, 'logs.sqlite'), '')
    fs.mkdirSync(path.join(codexHome, 'logs_10.sqlite'))
    expect(findCodexLogDatabase(codexHome)).toBe(path.join(codexHome, 'logs_9.sqlite'))
    expect(inspectCodexLogSchema(codexHome)).toMatchObject({
      database: path.join(codexHome, 'logs_9.sqlite'),
      endpointCompatible: true,
      rateLimitCompatible: true,
    })
  })

  it('resolves a Codex process that has not created a session yet', () => {
    const codexHome = codexHomeWithLogs([init(2_000, `pid:${process.pid}:uuid`, 'https://mine.example.com/v1')])
    clock += 60_000
    expect(resolveProcessEndpoint(process.pid, new Date(1_000_000), { CODEX_HOME: codexHome }, clock)).toEqual({
      url: 'https://mine.example.com/v1',
      source: 'log-init',
    })
  })

  it('keeps a confirmed process endpoint when its init log is pruned', () => {
    const codexHome = codexHomeWithLogs([init(2_000, `pid:${process.pid}:uuid`, 'https://mine.example.com/v1')])
    clock += 60_000
    const first = resolveProcessEndpoint(process.pid, new Date(1_000_000), { CODEX_HOME: codexHome }, clock)
    execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), 'DELETE FROM logs;'])

    expect(resolveProcessEndpoint(
      process.pid,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock + 60_000,
    )).toEqual(first)
  })

  it('reads a WAL database that has no live writer', () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-wal-'))
    directories.push(codexHome)
    const database = path.join(codexHome, 'logs_2.sqlite')
    execFileSync('sqlite3', [database, [
      'PRAGMA journal_mode=WAL;',
      'CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER, ts_nanos INTEGER, process_uuid TEXT, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
      `INSERT INTO logs VALUES (1, 10, 0, 'pid:1:uuid', 'thread-wal', 'codex_http_client::default_client', 'Request completed method=POST url=https://wal.example.com/v1/responses status=200 OK');`,
    ].join('\n')])
    // A clean close checkpoints the sidecar files away, but the header stays
    // WAL: the state where a read-only connection cannot create the missing
    // -shm and fails outright.
    fs.rmSync(`${database}-wal`, { force: true })
    fs.rmSync(`${database}-shm`, { force: true })

    expect(resolve(codexHome, 'thread-wal')?.url).toBe('https://wal.example.com/v1/responses')
  })

  it('resolves the root session owned by the Codex process', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const mine = path.join(cwd, 'rollout-mine.jsonl')
    const theirs = path.join(cwd, 'rollout-theirs.jsonl')
    fs.writeFileSync(mine, '')
    fs.writeFileSync(theirs, '')
    const codexHome = codexHomeWithLogs([
      { ts: 2_000, processUuid: `pid:${process.pid}:mine`, threadId: 'thread-mine', target: 'session', body: '' },
      { ts: 2_001, processUuid: 'pid:999999:theirs', threadId: 'thread-theirs', target: 'session', body: '' },
    ])
    addStateThreads(codexHome, [
      { id: 'thread-mine', rolloutPath: mine, cwd, createdAtMs: 2_000_000 },
      { id: 'thread-theirs', rolloutPath: theirs, cwd, createdAtMs: 2_001_000 },
    ])
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toEqual({ sessionId: 'thread-mine', rolloutPath: mine })
  })

  it.skipIf(process.platform !== 'linux')('resolves process sessions across WSL drive path casing', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-wsl-process-'))
    directories.push(directory)
    const rolloutPath = path.join(directory, 'rollout-wsl.jsonl')
    fs.writeFileSync(rolloutPath, '')
    const codexHome = codexHomeWithLogs([
      { ts: 2_000, processUuid: `pid:${process.pid}:wsl`, threadId: 'thread-wsl', target: 'session', body: '' },
    ])
    addStateThreads(codexHome, [{
      id: 'thread-wsl',
      rolloutPath,
      cwd: '/mnt/d/__codexhudfixture__/project',
      createdAtMs: 2_000_000,
    }])
    clock += 2_000

    expect(resolveProcessSession(
      process.pid,
      '/mnt/d/__CodexHudFixture__/Project',
      new Date(1_000_000),
      { CODEX_HOME: codexHome, WSL_DISTRO_NAME: 'Ubuntu' },
      clock,
    )).toEqual({ sessionId: 'thread-wsl', rolloutPath })
  })

  it('does not borrow another process session from the same cwd', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const theirs = path.join(cwd, 'rollout-theirs.jsonl')
    fs.writeFileSync(theirs, '')
    const codexHome = codexHomeWithLogs([
      { ts: 2_000, processUuid: 'pid:999999:theirs', threadId: 'thread-theirs', target: 'session', body: '' },
    ])
    addStateThreads(codexHome, [
      { id: 'thread-theirs', rolloutPath: theirs, cwd, createdAtMs: 2_000_000 },
    ])
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toBeNull()
  })

  it('binds a daemon-hosted session created by this launch', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const older = path.join(cwd, 'rollout-older.jsonl')
    const mine = path.join(cwd, 'rollout-mine.jsonl')
    const later = path.join(cwd, 'rollout-later.jsonl')
    for (const rollout of [older, mine, later]) {
      fs.writeFileSync(rollout, '')
    }
    // Daemon world: no log row is owned by the TUI process, and the daemon's
    // own rows cannot disambiguate concurrent sessions. The thread registry
    // must resolve this launch's session by cwd and creation time instead.
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-daemon-'))
    directories.push(codexHome)
    installManagedDaemon(codexHome)
    addStateThreads(codexHome, [
      { id: 'thread-older', rolloutPath: older, cwd, createdAtMs: 400_000 },
      { id: 'thread-mine', rolloutPath: mine, cwd, createdAtMs: 1_002_000 },
      { id: 'thread-later', rolloutPath: later, cwd, createdAtMs: 1_200_000 },
    ])
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toEqual({ sessionId: 'thread-mine', rolloutPath: mine })
  })

  it('does not adopt a daemon-hosted thread created before this launch', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const stale = path.join(cwd, 'rollout-stale.jsonl')
    fs.writeFileSync(stale, '')
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-daemon-'))
    directories.push(codexHome)
    installManagedDaemon(codexHome)
    addStateThreads(codexHome, [
      { id: 'thread-stale', rolloutPath: stale, cwd, createdAtMs: 400_000 },
    ])
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toBeNull()
  })

  it('skips subagent and agent threads in the daemon-hosted lookup', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const subagent = path.join(cwd, 'rollout-subagent.jsonl')
    const agent = path.join(cwd, 'rollout-agent.jsonl')
    const mine = path.join(cwd, 'rollout-mine.jsonl')
    for (const rollout of [subagent, agent, mine]) {
      fs.writeFileSync(rollout, '')
    }
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-daemon-'))
    directories.push(codexHome)
    installManagedDaemon(codexHome)
    addStateThreads(codexHome, [
      { id: 'thread-subagent', rolloutPath: subagent, cwd, threadSource: 'subagent', createdAtMs: 1_000_500 },
      { id: 'thread-agent', rolloutPath: agent, cwd, agentPath: '/agent.md', createdAtMs: 1_001_000 },
      { id: 'thread-mine', rolloutPath: mine, cwd, createdAtMs: 1_002_000 },
    ])
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toEqual({ sessionId: 'thread-mine', rolloutPath: mine })
  })

  it('prefers the newest state schema for daemon-hosted lookups', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const mine = path.join(cwd, 'rollout-mine.jsonl')
    fs.writeFileSync(mine, '')
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-daemon-'))
    directories.push(codexHome)
    installManagedDaemon(codexHome)
    addStateThreads(codexHome, [
      { id: 'thread-mine', rolloutPath: mine, cwd, createdAtMs: 1_002_000 },
    ])
    fs.renameSync(path.join(codexHome, 'state_5.sqlite'), path.join(codexHome, 'state_9.sqlite'))
    fs.writeFileSync(path.join(codexHome, 'state.sqlite'), '')
    fs.mkdirSync(path.join(codexHome, 'state_10.sqlite'))
    clock += 2_000
    expect(resolveProcessSession(
      process.pid,
      cwd,
      new Date(1_000_000),
      { CODEX_HOME: codexHome },
      clock,
    )).toEqual({ sessionId: 'thread-mine', rolloutPath: mine })
  })

  it('discovers a delayed app-server rollout through multiple process generations', () => {
    processSnapshot.stdout = '51001 1\n51002 51001\n51003 51002\n51004 51003\n52001 1\n52002 52001\n'
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const mine = path.join(cwd, 'mine.jsonl')
    const theirs = path.join(cwd, 'theirs.jsonl')
    fs.writeFileSync(mine, '')
    fs.writeFileSync(theirs, '')
    const codexHome = codexHomeWithLogs([
      { ts: 1_420, processUuid: 'pid:51003:daemon', threadId: 'thread-mine', target: 'session', body: '' },
      { ts: 1_410, processUuid: 'pid:52002:neighbor', threadId: 'thread-theirs', target: 'session', body: '' },
    ])
    addStateThreads(codexHome, [
      { id: 'thread-mine', rolloutPath: mine, cwd, createdAtMs: 1_420_000 },
      { id: 'thread-theirs', rolloutPath: theirs, cwd, createdAtMs: 1_410_000 },
    ])
    expect(resolveProcessSession(51001, cwd, new Date(1_000_000), { CODEX_HOME: codexHome }))
      .toEqual({ sessionId: 'thread-mine', rolloutPath: mine })
  })

  it('does not guess between root threads owned by the same descendant server', () => {
    processSnapshot.stdout = '51001 1\n51002 51001\n51003 51002\n'
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-project-'))
    directories.push(cwd)
    const rollout = path.join(cwd, 'rollout.jsonl')
    fs.writeFileSync(rollout, '')
    const codexHome = codexHomeWithLogs([
      { ts: 1_420, processUuid: 'pid:51003:daemon', threadId: 'thread-a', target: 'session', body: '' },
      { ts: 1_430, processUuid: 'pid:51003:daemon', threadId: 'thread-b', target: 'session', body: '' },
    ])
    installManagedDaemon(codexHome)
    addStateThreads(codexHome, ['thread-a', 'thread-b'].map(id => ({ id, rolloutPath: rollout, cwd })))
    expect(resolveProcessSession(51001, cwd, new Date(1_000_000), { CODEX_HOME: codexHome })).toBeNull()
  })

  it('ignores malformed process rows and cycles while finding a descendant endpoint', () => {
    processSnapshot.stdout = '51001 51003\n51002 51001\n51003 51002\n51004junk 51001\n52001 1\n'
    const codexHome = codexHomeWithLogs([
      init(1_420, 'pid:51003:daemon', 'https://mine.example.com'),
      init(1_430, 'pid:51004:invalid', 'https://invalid.example.com'),
      init(1_440, 'pid:52001:neighbor', 'https://neighbor.example.com'),
    ])
    expect(resolveProcessEndpoint(51001, new Date(1_000_000), { CODEX_HOME: codexHome }))
      .toEqual({ url: 'https://mine.example.com', source: 'log-init' })
  })

  it('does not trust partial process output after a failed snapshot', () => {
    processSnapshot.stdout = '51002 51001\n'
    processSnapshot.status = 1
    const codexHome = codexHomeWithLogs([init(1_420, 'pid:51002:daemon', 'https://partial.example.com')])
    expect(resolveProcessEndpoint(51001, new Date(1_000_000), { CODEX_HOME: codexHome })).toBeNull()
  })

  it('bounds oversized descendant trees without adopting a partial family', () => {
    processSnapshot.stdout = Array.from({ length: 256 }, (_, i) => `${51002 + i} 51001`).join('\n')
    const codexHome = codexHomeWithLogs([init(1_420, 'pid:51002:daemon', 'https://partial.example.com')])
    expect(resolveProcessEndpoint(51001, new Date(1_000_000), { CODEX_HOME: codexHome })).toBeNull()
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
