import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readLatestLoggedRateLimits } from './log-rate-limits.js'

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

function rateLimit(ts: number, processUuid: string, usedPercent: number, resetAt = nowSeconds + 604_800): LogRow {
  return {
    ts,
    processUuid,
    target: 'codex_api::sse::responses',
    body: `SSE event: ${JSON.stringify({
      type: 'codex.rate_limits',
      plan_type: 'team',
      rate_limits: {
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
    target: 'codex_http_client::default_client',
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

    const snapshot = readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now)

    expect(snapshot).toMatchObject({
      usage: {
        primary: { label: '1w', percent: 80, windowMinutes: 10_080 },
        planType: 'team',
      },
      observedAt: new Date((nowSeconds - 30) * 1_000),
    })

    fs.rmSync(path.join(codexHome, 'logs_2.sqlite'))
    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now + 16_000)).toMatchObject({
      usage: { primary: { percent: 80 } },
    })
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(codexHome, 'codex-hud', 'account-usage.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects a logged window after its reset time', () => {
    const codexHome = codexHomeWithLogs([
      rateLimit(nowSeconds - 60, 'pid:1:mine', 99, nowSeconds - 1),
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now)).toBeNull()
  })

  it('returns null when the log has no rate-limit event', () => {
    const codexHome = codexHomeWithLogs([
      request(nowSeconds - 60, 'pid:1:mine', 'https://mine.example.com/v1/responses'),
    ])

    expect(readLatestLoggedRateLimits({ CODEX_HOME: codexHome }, now)).toBeNull()
  })
})
