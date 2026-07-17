import { describe, expect, it } from 'vitest'
import { formatPromptCacheCountdown } from './prompt-cache-line.js'

describe('prompt cache countdown', () => {
  it('shows minute granularity without seconds', () => {
    expect(formatPromptCacheCountdown(30_000)).toBe('<1m')
    expect(formatPromptCacheCountdown(270_000)).toBe('5m')
    expect(formatPromptCacheCountdown(3_900_000)).toBe('1h 5m')
    expect(formatPromptCacheCountdown(97_380_000)).toBe('1d 3h 3m')
    expect(formatPromptCacheCountdown(0)).toBe('expired')
  })
})
