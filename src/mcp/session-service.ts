import type { SessionCandidate } from '../codex/session-finder.js'
import type { HudSnapshot } from './hud-snapshot.js'
// @env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { RolloutParser } from '../codex/rollout-parser.js'
import { findActiveSession, isSubagentSource, listSessionCandidates } from '../codex/session-finder.js'
import { loadConfig } from '../config/load.js'
import { getCodexHome } from '../config/paths.js'
import { buildHudState } from '../runtime/state.js'
import { toHudSnapshot } from './hud-snapshot.js'

function sql(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`
}

function lookupThread(threadId: string, env: NodeJS.ProcessEnv): SessionCandidate | null {
  const database = path.join(getCodexHome(env), 'state_5.sqlite')
  if (!fs.existsSync(database))
    return null
  const result = spawnSync('sqlite3', [database, '-readonly', '-noheader', '-batch', [
    'SELECT id || char(9) || rollout_path || char(9) || cwd || char(9) || created_at_ms',
    `FROM threads WHERE id=${sql(threadId)} LIMIT 1;`,
  ].join('\n')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000 })
  const row = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const [id, rolloutPath, cwd, createdAt] = row.split('\t')
  if (id !== threadId || !rolloutPath || !cwd || !fs.existsSync(rolloutPath))
    return null
  return {
    path: rolloutPath,
    sessionId: id,
    cwd,
    startTime: new Date(Number(createdAt) || Date.now()),
    mtimeMs: fs.statSync(rolloutPath).mtimeMs,
  }
}

export interface SessionResolution {
  candidate: SessionCandidate | null
  source: 'thread-id' | 'active-session' | 'none'
  reason?: string
}

export function resolveSession(sessionId?: string, env: NodeJS.ProcessEnv = process.env): SessionResolution {
  const threadId = sessionId?.trim() || env.CODEX_THREAD_ID?.trim()
  if (threadId) {
    const candidate = lookupThread(threadId, env)
    if (candidate)
      return { candidate, source: 'thread-id' }
    return { candidate: null, source: 'none', reason: `Codex thread ${threadId} has no readable local rollout.` }
  }
  const candidate = findActiveSession({ cwd: process.cwd(), codexHome: getCodexHome(env) })
  return candidate
    ? { candidate, source: 'active-session' }
    : { candidate: null, source: 'none', reason: 'No active local Codex session was found.' }
}

export function listLocalSessions(env: NodeJS.ProcessEnv = process.env): SessionCandidate[] {
  return listSessionCandidates(getCodexHome(env))
    .filter(candidate => !isSubagentSource(candidate.source))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 50)
}

export interface HudStatusResult {
  snapshot: HudSnapshot | null
  binding: SessionResolution
}

export function readHudStatus(sessionId?: string, env: NodeJS.ProcessEnv = process.env): HudStatusResult {
  const binding = resolveSession(sessionId, env)
  if (!binding.candidate)
    return { snapshot: null, binding }
  const loaded = loadConfig(env)
  const parser = new RolloutParser()
  parser.setFile(binding.candidate.path)
  const state = buildHudState(
    binding.candidate.cwd,
    parser.parse(),
    binding.candidate.startTime,
    loaded.config,
    new Date(),
    null,
    null,
    null,
    null,
  )
  return { snapshot: toHudSnapshot(state), binding }
}
