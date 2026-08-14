import type { GitStatus } from '../types/state.js'
// @env node
import { spawnSync } from 'node:child_process'
import { setTimedCache } from '../runtime/timed-cache.js'

const GIT_TIMEOUT_MS = 1_500
const STATUS_CACHE_MS = 2_000
const ROOT_CACHE_MS = 5 * 60_000
const CACHE_MAX_AGE_MS = 30 * 60_000
const CACHE_MAX_ENTRIES = 64
const statusCache = new Map<string, { at: number, status: GitStatus | null }>()
const rootCache = new Map<string, { at: number, root: string | null }>()

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

export function findGitRoot(cwd: string, now = Date.now()): string | null {
  const cached = rootCache.get(cwd)
  if (cached && now - cached.at < ROOT_CACHE_MS) {
    return cached.root
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  setTimedCache(rootCache, cwd, { at: now, root }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
  return root
}

function changeType(xy: string): string {
  return xy[0] !== '.' ? xy[0] : xy[1] ?? '.'
}

export function collectGitStatus(cwd: string): GitStatus | null {
  const now = Date.now()
  const cached = statusCache.get(cwd)
  if (cached && now - cached.at < STATUS_CACHE_MS) {
    return cached.status ? structuredClone(cached.status) : null
  }
  const root = findGitRoot(cwd, now)
  if (!root) {
    setTimedCache(statusCache, cwd, { at: now, status: null }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
    return null
  }

  const output = git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'])
  if (output === null) {
    setTimedCache(statusCache, cwd, { at: now, status: null }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
    return null
  }
  const records = output.split('\0').filter(Boolean)
  let branch: string | null = null
  let oid: string | null = null
  let ahead = 0
  let behind = 0
  let modified = 0
  let added = 0
  let deleted = 0
  let untracked = 0
  let renamed = 0
  let copied = 0
  let typeChanged = 0
  let conflicted = 0

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      branch = value === '(detached)' ? null : value
      continue
    }
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length)
      oid = value === '(initial)' ? null : value.slice(0, 7)
      continue
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(record)
      ahead = Number(match?.[1] ?? 0)
      behind = Number(match?.[2] ?? 0)
      continue
    }
    if (record.startsWith('? ')) {
      untracked += 1
      continue
    }
    if (record.startsWith('u ')) {
      conflicted += 1
      continue
    }
    if (record.startsWith('1 ') || record.startsWith('2 ')) {
      const xy = record.slice(2, 4)
      const type = changeType(xy)
      if (type === 'R') {
        renamed += 1
      }
      else if (type === 'C') {
        copied += 1
      }
      else if (type === 'A') {
        added += 1
      }
      else if (type === 'D') {
        deleted += 1
      }
      else if (type === 'T') {
        typeChanged += 1
      }
      else {
        modified += 1
      }
      if (record.startsWith('2 ')) {
        index += 1
      }
    }
  }

  const status: GitStatus = {
    isGitRepo: true,
    branch: branch ?? oid,
    isDirty: modified + added + deleted + untracked + renamed + copied + typeChanged + conflicted > 0,
    ahead,
    behind,
    modified,
    added,
    deleted,
    untracked,
    renamed,
    copied,
    typeChanged,
    conflicted,
  }
  setTimedCache(statusCache, cwd, { at: now, status }, CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES)
  return structuredClone(status)
}
