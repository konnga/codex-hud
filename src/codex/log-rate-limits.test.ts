import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectLoggedRateLimitTargets,
  persistRolloutRateLimits,
  readLatestLoggedRateLimits,
} from './log-rate-limits.js'

const directories: string[] = []
const now = Date.parse('2026-08-11T06:00:00Z')
const nowSeconds = Math.floor(now / 1_000)

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

interface LogRow {
  ts: number
  processUuid: string
  target: string
  body: string
}

function sqlValue(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}

function codexHomeWithLogs(rows: LogRow[]): string {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-rate-log-'))
  directories.push(codexHome)
  execFileSync('sqlite3', [path.join(codexHome, 'logs_2.sqlite'), [
    'CREATE TABLE logs (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, ts_nanos INTEGER NOT NULL, process_uuid TEXT, thread_id TEXT, target TEXT, feedback_log_body TEXT);',
    'CREATE INDEX idx_logs_ts ON logs(ts DESC, ts_nanos DESC, id DESC);',
    ...rows.map((row, index) => `INSERT INTO logs VALUES (${[
      index + 1,
      row.ts,
      index,
      sqlValue(row.processUuid),
      'NULL',
      sqlValue(row.target),
      sqlValue(row.body),
    ].join(', ')});`),
  ].join('\n')])
  return codexHome
}

function rateLimit(
  ts: number,
  processUuid: string,
  usedPercent: number,
  resetAt = nowSeconds + 604_800,
  target = 'codex_api::sse::responses',
  limitId = 'codex',
  limitName = 'Codex',
): LogRow {
  return {
    ts,
    processUuid,
    target,
    body: `SSE event: ${JSON.stringify({
      type: 'codex.rate_limits',
      plan_type: 'team',
      rate_limits: {
        limit_id: limitId,
        limit_name: limitName,
        allowed: true,
        limit_reached: false,
        primary: { used_percent: usedPercent, window_minutes: 10_080, reset_at: resetAt },
        secondary: null,
      },
      credits: { has_credits: false, unlimited: false, balance: null },
    })}`,
  }
}

function request(ts: number, processUuid: string, endpoint: string): LogRow {
  return {
    ts,
    processUuid,
    target: 'codex_http_client::client',
    body: `Request completed method=POST url=${endpoint} status=200 OK`,
  }
}

describe('logged rate limits', () => {
  it('reads and shares the newest account-wide event', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 19),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
      rateLimit(nowSeconds - 30, 'pid:2:other', 80),
      request(nowSeconds - 30, 'pid:2:other', 'https://other.example.com/v1/responses'),
    ])

    const snapshot = readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://other.example.com/v1')

    expect(snapshot).toMatchObject({
      usage: {
        primary: { label: '1w', percent: 80, windowMinutes: 10_080 },
        planType: 'team',
      },
      observedAt: new Date((nowSeconds - 30) * 1_000),
      origin: 'https://other.example.com',
    })

    fs.rmSync(path.join(codexHome, 'logs_2.sqlite'))
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now + 16_000, 'https://other.example.com/v1')).toMatchObject({
      usage: { primary: { percent: 80 } },
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(codexHome, 'codex-hud', 'account-usage.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('discovers rate-limit events after Codex changes the tracing target', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 30, 'pid:1:chatgpt', 44, nowSeconds + 604_800, 'codex_core::new_stream_target'),
      request(nowSeconds - 30, 'pid:1:chatgpt', 'https://chatgpt.com/backend-api/codex/responses'),
      {
        ts: nowSeconds - 1,
        processUuid: 'pid:2:diagnostic',
        target: 'codex_tui::chatwidget::protocol_requests',
        body: 'tool command mentions SSE event: and codex.rate_limits but is not an event',
      },
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://chatgpt.com')).toMatchObject({
      usage: { primary: { percent: 44 } },
    })
    expect(inspectLoggedRateLimitTargets({ CODEX_HOME: codexHome }, now)).toEqual([
      { target: 'codex_core::new_stream_target', count: 1 },
    ])
  })

  it('rejects a logged window after its reset time', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 99, nowSeconds - 1),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://mine.example.com/v1')).toBeNull()
  })

  it('returns null when the log has no rate-limit event', () => {
    const codexHome = codexHomeWithLogs([
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://mine.example.com/v1')).toBeNull()
  })

  it('does not reuse a newer rate limit from another provider', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 19),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
      rateLimit(nowSeconds - 30, 'pid:2:other', 80),
      request(nowSeconds - 30, 'pid:2:other', 'https://other.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://mine.example.com/v1')).toMatchObject({
      usage: { primary: { percent: 19 } },
      origin: 'https://mine.example.com',
    })
  })

  it('shares account limits between sessions on the same official endpoint', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 30, 'pid:1:chatgpt', 42),
      request(nowSeconds - 30, 'pid:1:chatgpt', 'https://chatgpt.com/backend-api/codex/responses'),
    ])

    expect(readLatestLoggedRateLimits(
      { CODEX_HOME: codexHome },
      now,
      'https://chatgpt.com/backend-api/codex/responses',
    )).toMatchObject({
      usage: { primary: { percent: 42 }, planType: 'team' },
      origin: 'https://chatgpt.com',
    })
  })

  it('skips a newer model-specific event and keeps the account-wide quota', () => {
    const processUuid = 'pid:1:chatgpt'
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 30, processUuid, 42),
      request(nowSeconds - 30, processUuid, 'https://chatgpt.com/backend-api/codex/responses'),
      rateLimit(
        nowSeconds - 10,
        processUuid,
        0,
        nowSeconds + 604_800,
        'codex_api::sse::responses',
        'codex_bengalfox',
        'GPT-5.3-Codex-Spark',
      ),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://chatgpt.com')).toMatchObject({
      usage: { primary: { percent: 42 } },
      source: 'log',
    })
  })

  it('shares an account-wide rollout observation when Codex logs no limit event', () => {
    const codexHome = codexHomeWithLogs([])
    const env = { CODEX_HOME: codexHome }
    persistRolloutRateLimits({
      primary: { label: '1w', percent: 17, resetAt: new Date((nowSeconds + 604_800) * 1_000), windowMinutes: 10_080 },
      secondary: null,
      individual: null,
      planType: 'prolite',
      balanceLabel: null,
      limitReachedType: null,
    }, new Date((nowSeconds - 30) * 1_000), 'https://chatgpt.com/backend-api/codex/responses', env)
    fs.rmSync(path.join(codexHome, 'logs_2.sqlite'))

    expect(readLatestLoggedRateLimits(env, now, 'https://chatgpt.com')).toMatchObject({
      usage: {
        primary: { label: '1w', percent: 17, windowMinutes: 10_080 },
        planType: 'prolite',
      },
      observedAt: new Date((nowSeconds - 30) * 1_000),
      origin: 'https://chatgpt.com',
      source: 'rollout-cache',
    })
  })

  it('keeps a newer shared rollout observation when the log event is older', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:chatgpt', 31),
      request(nowSeconds - 60, 'pid:1:chatgpt', 'https://chatgpt.com/backend-api/codex/responses'),
    ])
    const env = { CODEX_HOME: codexHome }
    persistRolloutRateLimits({
      primary: { label: '1w', percent: 32, resetAt: new Date((nowSeconds + 604_800) * 1_000), windowMinutes: 10_080 },
      secondary: null,
      individual: null,
      planType: 'prolite',
      balanceLabel: null,
      limitReachedType: null,
    }, new Date((nowSeconds - 10) * 1_000), 'https://chatgpt.com/backend-api/codex/responses', env)

    expect(readLatestLoggedRateLimits(env, now, 'https://chatgpt.com')).toMatchObject({
      usage: { primary: { percent: 32 } },
      observedAt: new Date((nowSeconds - 10) * 1_000),
      source: 'rollout-cache',
    })
  })

  it('refreshes an expired in-memory value from a newer shared snapshot', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:chatgpt', 31),
      request(nowSeconds - 60, 'pid:1:chatgpt', 'https://chatgpt.com/backend-api/codex/responses'),
    ])
    const env = { CODEX_HOME: codexHome }
    expect(readLatestLoggedRateLimits(env, now, 'https://chatgpt.com')).toMatchObject({
      usage: { primary: { percent: 31 } },
      source: 'log',
    })

    persistRolloutRateLimits({
      primary: { label: '1w', percent: 32, resetAt: new Date((nowSeconds + 604_800) * 1_000), windowMinutes: 10_080 },
      secondary: null,
      individual: null,
      planType: 'prolite',
      balanceLabel: null,
      limitReachedType: null,
    }, new Date(now + 10_000), 'https://chatgpt.com/backend-api/codex/responses', env)

    expect(readLatestLoggedRateLimits(env, now + 20_000, 'https://chatgpt.com')).toMatchObject({
      usage: { primary: { percent: 32 } },
      observedAt: new Date(now + 10_000),
      source: 'rollout-cache',
    })
  })

  it('does not persist rollout usage for a third-party endpoint', () => {
    const codexHome = codexHomeWithLogs([])
    persistRolloutRateLimits({
      primary: { label: '1w', percent: 17, resetAt: new Date((nowSeconds + 604_800) * 1_000), windowMinutes: 10_080 },
      secondary: null,
      individual: null,
      planType: 'prolite',
      balanceLabel: null,
      limitReachedType: null,
    }, new Date((nowSeconds - 30) * 1_000), 'https://relay.example.com/v1/responses', { CODEX_HOME: codexHome })

    expect(fs.existsSync(path.join(codexHome, 'codex-hud', 'account-usage.json'))).toBe(false)
  })

  it('hides usage while the session endpoint is unknown', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 30, 'pid:1:mine', 42),
      request(nowSeconds - 30, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, null)).toBeNull()
    // The unknown-endpoint answer must not be cached for unfiltered callers.
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now)).toMatchObject({
      usage: { primary: { percent: 42 } },
      origin: 'https://mine.example.com',
    })
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, null)).toBeNull()
  })

  it('returns the newest provider event when no endpoint filter is given', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 19),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
      rateLimit(nowSeconds - 30, 'pid:2:other', 80),
      request(nowSeconds - 30, 'pid:2:other', 'https://other.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now)).toMatchObject({
      usage: { primary: { percent: 80 } },
      origin: 'https://other.example.com',
    })
  })

  it('keeps snapshot entries from other providers when writing a new one', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 19),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
      rateLimit(nowSeconds - 30, 'pid:2:other', 80),
      request(nowSeconds - 30, 'pid:2:other', 'https://other.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://mine.example.com/v1'))
      .toMatchObject({ origin: 'https://mine.example.com' })
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://other.example.com/v1'))
      .toMatchObject({ origin: 'https://other.example.com' })

    const stored = JSON.parse(fs.readFileSync(path.join(codexHome, 'codex-hud', 'account-usage.json'), 'utf8'))
    expect(Object.keys(stored.entries).sort()).toEqual(['https://mine.example.com', 'https://other.example.com'])

    fs.rmSync(path.join(codexHome, 'logs_2.sqlite'))
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now + 16_000, 'https://mine.example.com/v1')).toMatchObject({
      usage: { primary: { percent: 19 } },
      origin: 'https://mine.example.com',
    })
  })

  it('ignores a legacy snapshot that has no provider origin', () => {
    const codexHome = codexHomeWithLogs([])
    const stateDirectory = path.join(codexHome, 'codex-hud')
    fs.mkdirSync(stateDirectory)
    fs.writeFileSync(path.join(stateDirectory, 'account-usage.json'), JSON.stringify({
      version: 1,
      observed_at: new Date(now - 60_000).toISOString(),
      body: rateLimit(nowSeconds - 60, 'pid:1:mine', 99).body,
    }))

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now, 'https://mine.example.com/v1')).toBeNull()
  })
})
