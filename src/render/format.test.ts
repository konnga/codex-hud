import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatResetTime } from './format.js'

describe('duration formatting', () => {
  it('uses minute granularity without seconds', () => {
    expect(formatDuration(35_000)).toBe('<1m')
    expect(formatDuration(215_000)).toBe('3m')
    expect(formatDuration(3_600_000)).toBe('1h')
    expect(formatDuration(4_320_000)).toBe('1h 12m')
    expect(formatDuration(97_380_000)).toBe('1d 3h 3m')
  })
})

describe('byte formatting', () => {
  it('scales to a readable unit instead of a token count', () => {
    expect(formatBytes(16 * 1024 ** 3)).toBe('16 GB')
    expect(formatBytes(1536 * 1024 ** 2)).toBe('1.5 GB')
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
  })
})

describe('reset time formatting', () => {
  it('renders an absolute reset date and time', () => {
    const resetAt = new Date('2026-09-06T09:26:00Z')
    const value = formatResetTime(resetAt, new Date('2026-09-06T08:00:00Z'), 'absolute', null, 'en-US')
    expect(value).toBe(resetAt.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }))
  })

  it('uses Chinese month and day names for the Chinese HUD', () => {
    const value = formatResetTime(
      new Date('2026-09-06T09:26:00Z'),
      new Date('2026-09-06T08:00:00Z'),
      'absolute',
      null,
      'zh-CN',
    )
    expect(value).toContain('月')
    expect(value).toContain('日')
    expect(value).toMatch(/\d{1,2}:\d{2}$/)
  })
})
