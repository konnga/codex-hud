import { describe, expect, it } from 'vitest'
import { formatDuration } from './format.js'

describe('duration formatting', () => {
  it('uses minute granularity without seconds', () => {
    expect(formatDuration(35_000)).toBe('<1m')
    expect(formatDuration(215_000)).toBe('3m')
    expect(formatDuration(3_600_000)).toBe('1h')
    expect(formatDuration(4_320_000)).toBe('1h 12m')
    expect(formatDuration(97_380_000)).toBe('1d 3h 3m')
  })
})
