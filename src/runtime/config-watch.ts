// @env node
import type { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

export function isConfigPathEvent(configPath: string, filename: string | Buffer | null): boolean {
  return filename === null || filename.toString() === path.basename(configPath)
}

export function watchConfigPath(configPath: string, onChange: () => void): fs.FSWatcher | null {
  try {
    return fs.watch(path.dirname(configPath), (_event, filename) => {
      if (isConfigPathEvent(configPath, filename)) {
        onChange()
      }
    })
  }
  catch {
    return null
  }
}
