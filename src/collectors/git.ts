import type { GitStatus } from '../types/state.js'
// @env node
import { spawnSync } from 'node:child_process'

const GIT_TIMEOUT_MS = 1_500
const CACHE_MS = 2_000
const cache = new Map<string, { at: number, status: GitStatus | null }>()

function git(cwd: string, args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  })
  return result.status === 0 ? result.stdout.trim() : null
}

export function findGitRoot(cwd: string): string | null {
  return git(cwd, ['rev-parse', '--show-toplevel'])
}

export function collectGitStatus(cwd: string): GitStatus | null {
  const now = Date.now()
  const cached = cache.get(cwd)
  if (cached && now - cached.at < CACHE_MS) {
    return cached.status ? structuredClone(cached.status) : null
  }
  const root = findGitRoot(cwd)
  if (!root) {
    cache.set(cwd, { at: now, status: null })
    return null
  }

  const branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    ?? git(root, ['rev-parse', '--short', 'HEAD'])
  const porcelain = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal']) ?? ''
  const records = porcelain.split('\0').filter(Boolean)
  let modified = 0
  let added = 0
  let deleted = 0
  let untracked = 0

  for (const record of records) {
    const status = record.slice(0, 2)
    if (status === '??') {
      untracked += 1
      continue
    }
    if (status.includes('D')) {
      deleted += 1
    }
    else if (status.includes('A')) {
      added += 1
    }
    else {
      modified += 1
    }
  }

  const divergence = git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
  const [ahead = 0, behind = 0] = divergence
    ? divergence.split(/\s+/).map(value => Number.parseInt(value, 10) || 0)
    : [0, 0]

  const status = {
    isGitRepo: true,
    branch,
    isDirty: records.length > 0,
    ahead,
    behind,
    modified,
    added,
    deleted,
    untracked,
  }
  cache.set(cwd, { at: now, status })
  return structuredClone(status)
}
