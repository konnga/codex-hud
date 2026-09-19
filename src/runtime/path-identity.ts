// @env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const WSL_WINDOWS_DRIVE_PATH = /^\/mnt\/[a-z](?:\/|$)/i

function isWsl(env: NodeJS.ProcessEnv): boolean {
  if (process.platform !== 'linux') {
    return false
  }
  return Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP)
    || os.release().toLowerCase().includes('microsoft')
}

/** Paths backed by a case-insensitive filesystem need a stable comparison key. */
export function isCaseInsensitivePath(value: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform === 'win32') {
    return true
  }
  return isWsl(env) && WSL_WINDOWS_DRIVE_PATH.test(path.resolve(value))
}

export function pathIdentity(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let resolved: string
  try {
    resolved = fs.realpathSync.native(value)
  }
  catch {
    resolved = path.resolve(value)
  }
  return isCaseInsensitivePath(resolved, env) ? resolved.toLowerCase() : resolved
}
