import { describe, expect, it } from 'vitest'
import { pruneTimedCache, setTimedCache } from './timed-cache.js'

describe('timed cache', () => {
  it('removes expired and oldest entries', () => {
    const cache = new Map<string, { at: number, value: number }>()
    cache.set('expired', { at: 0, value: 0 })
    cache.set('old', { at: 900, value: 1 })
    cache.set('new', { at: 950, value: 2 })
    pruneTimedCache(cache, 1_000, 200, 1)
    expect([...cache.keys()]).toEqual(['new'])

    setTimedCache(cache, 'latest', { at: 1_100, value: 3 }, 200, 1)
    expect([...cache.keys()]).toEqual(['latest'])
  })
})
