import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readExternalUsage, resolveUsageData } from './external-usage.js'

const directories: string[] = []

afterEach(() => {
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
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
})
