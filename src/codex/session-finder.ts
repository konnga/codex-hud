import type { SessionSource } from '../types/rollout.js'
// @env node
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getCodexHome } from '../config/paths.js'

const MAX_SESSION_META_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

export interface SessionCandidate {
  path: string
  sessionId: string
  cwd: string
  startTime: Date
  mtimeMs: number
  source?: SessionSource
  parentThreadId?: string
  agentPath?: string
  agentNickname?: string
  agentRole?: string
}

export interface FindSessionOptions {
  cwd: string
  codexHome?: string
  launchedAfter?: Date | null
  allowModifiedBeforeLaunch?: boolean
  maxAgeMs?: number
  now?: Date
}

function realPath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  }
  catch {
    return path.resolve(value)
  }
}

function normalizedPath(value: string): string {
  const resolved = realPath(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isWithinProject(candidateCwd: string, targetCwd: string): boolean {
  const candidate = normalizedPath(candidateCwd)
  const target = normalizedPath(targetCwd)
  return candidate === target || candidate.startsWith(`${target}${path.sep}`)
}

function readFirstLine(filePath: string): string | null {
  const descriptor = fs.openSync(filePath, 'r')
  try {
    const chunks: Buffer[] = []
    let total = 0
    let position = 0
    while (total < MAX_SESSION_META_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SESSION_META_BYTES - total))
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, position)
      if (bytesRead === 0) {
        break
      }
      const chunk = buffer.subarray(0, bytesRead)
      const newline = chunk.indexOf(10)
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline))
        return Buffer.concat(chunks).toString('utf8').replace(/\r$/, '')
      }
      chunks.push(chunk)
      total += bytesRead
      position += bytesRead
    }
    return chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null
  }
  finally {
    fs.closeSync(descriptor)
  }
}

function collectRolloutPaths(directory: string, output: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  }
  catch {
    return
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectRolloutPaths(entryPath, output)
    }
    else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) {
      output.push(entryPath)
    }
  }
}

export function isSubagentSource(source: SessionSource | undefined): boolean {
  if (!source || typeof source === 'string') {
    return typeof source === 'string' && source.toLowerCase().includes('subagent')
  }
  return 'subagent' in source || 'thread_spawn' in source
}

function threadSpawnMetadata(source: unknown): Record<string, unknown> | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null
  }
  const sourceRecord = source as Record<string, unknown>
  const subagent = sourceRecord.subagent
  if (subagent && typeof subagent === 'object' && !Array.isArray(subagent)) {
    const threadSpawn = (subagent as Record<string, unknown>).thread_spawn
    if (threadSpawn && typeof threadSpawn === 'object' && !Array.isArray(threadSpawn)) {
      return threadSpawn as Record<string, unknown>
    }
  }
  const direct = sourceRecord.thread_spawn
  return direct && typeof direct === 'object' && !Array.isArray(direct)
    ? direct as Record<string, unknown>
    : null
}

export function readSessionCandidate(filePath: string): SessionCandidate | null {
  try {
    const line = readFirstLine(filePath)
    if (!line) {
      return null
    }
    const entry = JSON.parse(line) as {
      type?: string
      timestamp?: string
      payload?: Record<string, unknown>
    }
    if (entry.type !== 'session_meta' || !entry.payload) {
      return null
    }
    const payload = entry.payload
    const sessionId = payload.session_id ?? payload.id
    const cwd = payload.cwd
    if (typeof sessionId !== 'string' || typeof cwd !== 'string') {
      return null
    }
    const stat = fs.statSync(filePath)
    const startTime = new Date(
      typeof payload.timestamp === 'string'
        ? payload.timestamp
        : entry.timestamp ?? stat.mtimeMs,
    )
    const source = (payload.thread_source ?? payload.source) as SessionSource | undefined
    const threadSpawn = threadSpawnMetadata(source)
    return {
      path: filePath,
      sessionId,
      cwd,
      startTime: Number.isNaN(startTime.getTime()) ? new Date(stat.mtimeMs) : startTime,
      mtimeMs: stat.mtimeMs,
      source,
      parentThreadId: typeof (payload.parent_thread_id ?? threadSpawn?.parent_thread_id) === 'string'
        ? (payload.parent_thread_id ?? threadSpawn?.parent_thread_id) as string
        : undefined,
      agentPath: typeof (payload.agent_path ?? threadSpawn?.agent_path) === 'string'
        ? (payload.agent_path ?? threadSpawn?.agent_path) as string
        : undefined,
      agentNickname: typeof threadSpawn?.agent_nickname === 'string' ? threadSpawn.agent_nickname : undefined,
      agentRole: typeof threadSpawn?.agent_role === 'string' ? threadSpawn.agent_role : undefined,
    }
  }
  catch {
    return null
  }
}

export function listSessionCandidates(codexHome = getCodexHome()): SessionCandidate[] {
  const paths: string[] = []
  collectRolloutPaths(path.join(codexHome, 'sessions'), paths)
  return paths.flatMap((filePath) => {
    const candidate = readSessionCandidate(filePath)
    return candidate ? [candidate] : []
  })
}

export function findActiveSession(options: FindSessionOptions): SessionCandidate | null {
  const now = options.now ?? new Date()
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const launchedAfterMs = options.launchedAfter?.getTime() ?? 0
  const allowModifiedBeforeLaunch = options.allowModifiedBeforeLaunch ?? true
  const candidates = listSessionCandidates(options.codexHome)
    .filter(candidate => !isSubagentSource(candidate.source))
    .filter(candidate => isWithinProject(candidate.cwd, options.cwd))
    .filter(candidate => candidate.mtimeMs >= now.getTime() - maxAgeMs)
    .filter(candidate => candidate.startTime.getTime() >= launchedAfterMs
      || (allowModifiedBeforeLaunch && candidate.mtimeMs >= launchedAfterMs))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
  return candidates[0] ?? null
}
