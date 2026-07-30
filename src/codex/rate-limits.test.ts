import { describe, expect, it } from 'vitest'
import { normalizeRateLimits } from './rate-limits.js'

describe('normalizeRateLimits', () => {
  it('does not assume a five-hour window when telemetry omits the duration', () => {
    expect(normalizeRateLimits({
      primary: { used_percent: 25 },
    })?.primary).toMatchObject({
      label: 'limit',
      percent: 25,
      windowMinutes: null,
    })
  })

  it('derives the label from the reported window duration', () => {
    const usage = normalizeRateLimits({
      primary: { used_percent: 25, window_minutes: 300 },
      secondary: { used_percent: 50, window_minutes: 10_080 },
    })

    expect(usage?.primary?.label).toBe('5h')
    expect(usage?.secondary?.label).toBe('1w')
  })
})
