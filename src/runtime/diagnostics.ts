// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getHudStateDirectory } from '../config/paths.js'

const FAILURE_LOG = 'launch-errors.jsonl'
const MAX_FAILURE_LOG_BYTES = 256 * 1024

export interface HudLaunchFailure {
  timestamp: string
  cwd: string
  backend: string
  error: string
}

function failurePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getHudStateDirectory(env), FAILURE_LOG)
}

export function recordHudLaunchFailure(
  failure: Omit<HudLaunchFailure, 'timestamp'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    const filePath = failurePath(env)
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
    const line = `${JSON.stringify({ ...failure, timestamp: new Date().toISOString() })}\n`
    let previous = ''
    try {
      previous = fs.readFileSync(filePath, 'utf8')
    }
    catch {
      // The diagnostics log is optional.
    }
    const content = `${previous}${line}`
    fs.writeFileSync(filePath, content.slice(-MAX_FAILURE_LOG_BYTES), { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(filePath, 0o600)
  }
  catch {
    // Diagnostics must never prevent Codex from starting.
  }
}

export function readLatestHudLaunchFailure(env: NodeJS.ProcessEnv = process.env): HudLaunchFailure | null {
  try {
    const lines = fs.readFileSync(failurePath(env), 'utf8').trim().split('\n').reverse()
    for (const line of lines) {
      try {
        const value = JSON.parse(line) as Partial<HudLaunchFailure>
        if (typeof value.timestamp === 'string' && typeof value.cwd === 'string'
          && typeof value.backend === 'string' && typeof value.error === 'string') {
          return value as HudLaunchFailure
        }
      }
      catch {
        // Ignore a partially written or malformed diagnostic line.
      }
    }
  }
  catch {
    // No diagnostics yet.
  }
  return null
}
