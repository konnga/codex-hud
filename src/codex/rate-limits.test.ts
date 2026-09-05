import type { UsageData } from '../types/state.js'
import { describe, expect, it } from 'vitest'
import { evaluateUsageTrust, mergeUsageData, normalizeRateLimits, trustedUsageDataForEndpoint } from './rate-limits.js'

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

  it('does not display the zero balance sent for accounts without credits', () => {
    const usage = normalizeRateLimits({
      primary: { used_percent: 0, window_minutes: 300 },
      credits: { has_credits: false, unlimited: false, balance: '0' },
      plan_type: 'pro',
    })

    expect(usage).toMatchObject({
      primary: { label: '5h', percent: 0 },
      planType: 'pro',
      balanceLabel: null,
    })
  })

  it('keeps an available credit balance', () => {
    expect(normalizeRateLimits({
      credits: { has_credits: true, unlimited: false, balance: '$12.50' },
    })?.balanceLabel).toBe('$12.50')
  })

  it('keeps nonzero balances from legacy events without a credits flag', () => {
    expect(normalizeRateLimits({
      credits: { balance: '$3.00' },
    })?.balanceLabel).toBe('$3.00')
  })

  it('merges account updates by duration instead of positional slot', () => {
    const current: UsageData = {
      primary: { label: '5h', percent: 25, resetAt: null, windowMinutes: 300 },
      secondary: { label: '1w', percent: 0, resetAt: null, windowMinutes: 10_080 },
      individual: null,
      planType: 'pro',
      balanceLabel: '$5',
      limitReachedType: null,
    }
    const observed: UsageData = {
      primary: { label: '1w', percent: 19, resetAt: new Date('2026-08-18T06:00:00Z'), windowMinutes: 10_080 },
      secondary: null,
      individual: null,
      planType: 'team',
      balanceLabel: null,
      limitReachedType: null,
    }

    expect(mergeUsageData(current, observed)).toEqual({
      primary: current.primary,
      secondary: observed.primary,
      individual: null,
      planType: 'team',
      balanceLabel: '$5',
      limitReachedType: null,
    })
  })

  it('keeps a lone weekly observation in the visible primary slot', () => {
    const observed = normalizeRateLimits({
      primary: { used_percent: 19, window_minutes: 10_080 },
    })

    expect(mergeUsageData(null, observed)?.primary).toMatchObject({
      label: '1w',
      percent: 19,
    })
  })
})

describe('trustedUsageDataForEndpoint', () => {
  const usage: UsageData = {
    primary: { label: '1w', percent: 38, resetAt: null, windowMinutes: 10_080 },
    secondary: null,
    individual: null,
    planType: 'team',
    balanceLabel: null,
    limitReachedType: null,
  }

  it('accepts native limits only from official OpenAI endpoints', () => {
    expect(trustedUsageDataForEndpoint('https://chatgpt.com/backend-api/codex/responses', usage, null)).toEqual(usage)
    expect(trustedUsageDataForEndpoint('https://api.openai.com/v1/responses', usage, null)).toEqual(usage)
    expect(trustedUsageDataForEndpoint('https://agentrouter.org/v1/responses', usage, null)).toBeNull()
    expect(trustedUsageDataForEndpoint(null, usage, null)).toBeNull()
  })

  it('trusts an endpoint-less OpenAI session only when it uses ChatGPT authentication', () => {
    expect(evaluateUsageTrust(null, true)).toEqual({
      trusted: true,
      reason: 'chatgpt-auth',
      effectiveEndpoint: 'https://chatgpt.com',
    })
    expect(evaluateUsageTrust(null, false).trusted).toBe(false)
    expect(evaluateUsageTrust('https://relay.example.com/v1', true)).toMatchObject({
      trusted: false,
      reason: 'untrusted-endpoint',
    })
  })
})
