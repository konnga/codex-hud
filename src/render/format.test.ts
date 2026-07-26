import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration } from './format.js'

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
