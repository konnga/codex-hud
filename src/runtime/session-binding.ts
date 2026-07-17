// @env node
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isSubagentSource, listSessionCandidates } from '../codex/session-finder.js'
import { getCodexHome, getHudStateDirectory } from '../config/paths.js'

const DISCOVERY_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 30_000

function normalizedPath(value: string): string {
  let resolved: string
  try {
    resolved = fs.realpathSync.native(value)
  }
  catch {
    resolved = path.resolve(value)
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function rootSessions(cwd: string, codexHome = getCodexHome()) {
  const normalizedCwd = normalizedPath(cwd)
  return listSessionCandidates(codexHome)
    .filter(candidate => !isSubagentSource(candidate.source))
    .filter(candidate => normalizedPath(candidate.cwd) === normalizedCwd)
}

export type SessionSnapshot = ReadonlyMap<string, number>

export function snapshotRootSessions(cwd: string, codexHome = getCodexHome()): Map<string, number> {
  return new Map(rootSessions(cwd, codexHome).map(candidate => [candidate.path, candidate.mtimeMs]))
}

export function findNewRootSession(
  cwd: string,
  snapshot: SessionSnapshot,
  codexHome = getCodexHome(),
  allowModified = false,
) {
  return rootSessions(cwd, codexHome)
    .filter(candidate => !snapshot.has(candidate.path)
      || (allowModified && candidate.mtimeMs > (snapshot.get(candidate.path) ?? 0)))
    .sort((left, right) => {
      const leftIsNew = !snapshot.has(left.path)
      const rightIsNew = !snapshot.has(right.path)
      if (leftIsNew !== rightIsNew) {
        return leftIsNew ? -1 : 1
      }
      return left.startTime.getTime() - right.startTime.getTime()
    })[0] ?? null
}

export function createSessionBindingPath(cwd: string): string {
  const digest = createHash('sha1').update(normalizedPath(cwd)).digest('hex').slice(0, 12)
  return path.join(getHudStateDirectory(), 'bindings', `${digest}-${randomUUID()}.json`)
}

export function writeSessionBinding(bindingPath: string, rolloutPath: string): void {
  fs.mkdirSync(path.dirname(bindingPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${bindingPath}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ rolloutPath })}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, bindingPath)
}

export function readSessionBinding(bindingPath: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(bindingPath, 'utf8')) as { rolloutPath?: unknown }
    return typeof value.rolloutPath === 'string' && fs.existsSync(value.rolloutPath)
      ? value.rolloutPath
      : null
  }
  catch {
    return null
  }
}

function lockPath(cwd: string): string {
  const digest = createHash('sha1').update(normalizedPath(cwd)).digest('hex')
  return path.join(getHudStateDirectory(), 'bindings', 'locks', digest)
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, milliseconds)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

export async function acquireSessionDiscoveryLock(cwd: string): Promise<() => void> {
  const target = lockPath(cwd)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  while (true) {
    try {
      fs.mkdirSync(target, { mode: 0o700 })
      return () => fs.rmSync(target, { recursive: true, force: true })
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      try {
        if (Date.now() - fs.statSync(target).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(target, { recursive: true, force: true })
          continue
        }
      }
      catch {
        continue
      }
      await delay(25)
    }
  }
}

export async function waitForNewRootSession(
  cwd: string,
  snapshot: SessionSnapshot,
  codexHome = getCodexHome(),
  timeoutMs = DISCOVERY_TIMEOUT_MS,
  signal?: AbortSignal,
  allowModified = false,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  do {
    if (signal?.aborted) {
      return null
    }
    const session = findNewRootSession(cwd, snapshot, codexHome, allowModified)
    if (session) {
      return session.path
    }
    await delay(25, signal)
  } while (Date.now() < deadline)
  return null
}
