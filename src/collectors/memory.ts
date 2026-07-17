import type { MemoryInfo } from '../types/state.js'
// @env node
import os from 'node:os'

export function collectMemoryInfo(): MemoryInfo {
  const totalBytes = os.totalmem()
  const freeBytes = os.freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  return {
    totalBytes,
    usedBytes,
    freeBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
  }
}
