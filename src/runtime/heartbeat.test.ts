import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHeartbeatScheduler } from './heartbeat.js'

afterEach(() => vi.useRealTimers())

describe('heartbeat scheduler', () => {
  it('uses the configured interval and reschedules live', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const scheduler = createHeartbeatScheduler(callback)
    scheduler.reschedule(300)
    vi.advanceTimersByTime(900)
    expect(callback).toHaveBeenCalledTimes(3)
    scheduler.reschedule(1_000)
    vi.advanceTimersByTime(999)
    expect(callback).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(1)
    expect(callback).toHaveBeenCalledTimes(4)
    scheduler.stop()
  })
})
