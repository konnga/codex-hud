import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { isConfigPathEvent } from './config-watch.js'

describe('config directory watcher', () => {
  it('accepts config events and ignores unrelated files', () => {
    const configPath = '/tmp/codex-hud/config.json'
    expect(isConfigPathEvent(configPath, 'config.json')).toBe(true)
    expect(isConfigPathEvent(configPath, Buffer.from('config.json'))).toBe(true)
    expect(isConfigPathEvent(configPath, null)).toBe(true)
    expect(isConfigPathEvent(configPath, '.config.json.123.tmp')).toBe(false)
    expect(isConfigPathEvent(configPath, 'other.json')).toBe(false)
  })
})
