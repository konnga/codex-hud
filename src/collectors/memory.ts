import type { MemoryInfo } from '../types/state.js'
// @env node
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'

const MEMORY_CACHE_MS = 5_000
// Pages macOS can hand back on demand. Anything else counts as in use.
const RECLAIMABLE_PAGES = ['free', 'inactive', 'speculative', 'purgeable']

let cache: { at: number, value: MemoryInfo } | null = null

/**
 * `os.freemem()` on macOS counts only wholly free pages, so cached and inactive
 * memory reads as used and every Mac reports ~100%. vm_stat exposes the pages
 * the kernel can actually reclaim.
 */
function darwinAvailableBytes(): number | null {
  const result = spawnSync('vm_stat', [], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 500,
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null
  }
  const pageSize = Number(/page size of (\d+) bytes/.exec(result.stdout)?.[1])
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null
  }
  let pages = 0
  for (const name of RECLAIMABLE_PAGES) {
    const match = new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'im').exec(result.stdout)
    if (match) {
      pages += Number(match[1])
    }
  }
  return pages > 0 ? pages * pageSize : null
}

export function collectMemoryInfo(now = Date.now()): MemoryInfo {
  if (cache && now - cache.at < MEMORY_CACHE_MS) {
    return { ...cache.value }
  }
  const totalBytes = os.totalmem()
  const freeBytes = (process.platform === 'darwin' ? darwinAvailableBytes() : null) ?? os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const value: MemoryInfo = {
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
  }
  cache = { at: now, value }
  return { ...value }
}
