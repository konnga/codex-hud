import type { SessionCandidate } from '../codex/session-finder.js'
import type { AgentEntry, SessionInfo } from '../types/state.js'
// @env node
import fs from 'node:fs'
import process from 'node:process'
import { isSubagentSource, listSessionCandidates } from '../codex/session-finder.js'
import { getCodexHome } from '../config/paths.js'

const COMPLETED_VISIBLE_MS = 30_000
const STARTING_VISIBLE_MS = 15 * 60_000
const CACHE_MS = 1_000

interface AgentRuntime {
  entry: AgentEntry
  parentThreadId: string
  active: boolean
}

interface ParsedAgentRollout {
  active: boolean
  model?: string
  startedAt: Date
  lastTimestamp: Date
}

let cache: { key: string, at: number, agents: AgentEntry[] } | null = null
const rolloutCache = new Map<string, { mtimeMs: number, size: number, value: ParsedAgentRollout | null }>()

function safeDate(value: unknown, fallback: Date): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? fallback : date
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? fallback : date
  }
  return fallback
}

function label(candidate: SessionCandidate): string {
  if (candidate.agentNickname) {
    return candidate.agentNickname
  }
  if (candidate.agentPath) {
    return candidate.agentPath.slice(candidate.agentPath.lastIndexOf('/') + 1)
  }
  if (candidate.agentRole) {
    return candidate.agentRole
  }
  return `agent-${candidate.sessionId.slice(0, 8)}`
}

function readAgentRollout(candidate: SessionCandidate): ParsedAgentRollout | null {
  let stat: fs.Stats
  try {
    stat = fs.statSync(candidate.path)
  }
  catch {
    return null
  }
  const cached = rolloutCache.get(candidate.path)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.value ? structuredClone(cached.value) : null
  }
  const activeTurns = new Set<string>()
  let model: string | undefined
  let startedAt = candidate.startTime
  let lastTimestamp = candidate.startTime
  try {
    const lines = fs.readFileSync(candidate.path, 'utf8').split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      let entry: { timestamp?: string, type?: string, payload?: Record<string, unknown> }
      try {
        entry = JSON.parse(line) as typeof entry
      }
      catch {
        continue
      }
      lastTimestamp = safeDate(entry.timestamp, lastTimestamp)
      const payload = entry.payload
      if (!payload) {
        continue
      }
      if (entry.type === 'turn_context') {
        const collaboration = payload.collaboration_mode
        const settings = collaboration && typeof collaboration === 'object' && !Array.isArray(collaboration)
          ? (collaboration as Record<string, unknown>).settings
          : null
        model = typeof payload.model === 'string'
          ? payload.model
          : settings && typeof settings === 'object' && !Array.isArray(settings) && typeof (settings as Record<string, unknown>).model === 'string'
            ? (settings as Record<string, unknown>).model as string
            : model
      }
      if (entry.type !== 'event_msg') {
        continue
      }
      if (payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        activeTurns.add(payload.turn_id)
        startedAt = safeDate(payload.started_at, lastTimestamp)
      }
      else if (payload.type === 'task_complete' && typeof payload.turn_id === 'string') {
        activeTurns.delete(payload.turn_id)
      }
      else if (payload.type === 'turn_aborted') {
        if (typeof payload.turn_id === 'string') {
          activeTurns.delete(payload.turn_id)
        }
        else {
          activeTurns.clear()
        }
      }
    }
  }
  catch {
    rolloutCache.set(candidate.path, { mtimeMs: stat.mtimeMs, size: stat.size, value: null })
    return null
  }

  const value: ParsedAgentRollout = {
    active: activeTurns.size > 0,
    model,
    startedAt,
    lastTimestamp,
  }
  rolloutCache.set(candidate.path, { mtimeMs: stat.mtimeMs, size: stat.size, value })
  return structuredClone(value)
}

function parseAgent(candidate: SessionCandidate, now: Date): AgentRuntime | null {
  const parsed = readAgentRollout(candidate)
  if (!parsed) {
    return null
  }
  const active = parsed.active
  const ageMs = now.getTime() - candidate.mtimeMs
  const starting = !active && ageMs < STARTING_VISIBLE_MS && candidate.mtimeMs === candidate.startTime.getTime()
  if (!active && !starting && ageMs > COMPLETED_VISIBLE_MS) {
    return null
  }
  return {
    parentThreadId: candidate.parentThreadId ?? '',
    active,
    entry: {
      id: candidate.sessionId,
      type: label(candidate),
      model: parsed.model,
      description: candidate.agentRole,
      path: candidate.agentPath,
      status: active ? 'running' : starting ? 'starting' : 'completed',
      startTime: parsed.startedAt,
      endTime: active || starting ? undefined : parsed.lastTimestamp,
    },
  }
}

function descendants(rootThreadId: string, runtimes: AgentRuntime[]): AgentRuntime[] {
  const visible = new Set([rootThreadId])
  const result: AgentRuntime[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const runtime of runtimes) {
      if (!visible.has(runtime.entry.id) && visible.has(runtime.parentThreadId)) {
        visible.add(runtime.entry.id)
        result.push(runtime)
        changed = true
      }
    }
  }
  return result
}

export function collectAgentEntries(
  session: SessionInfo | null,
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): AgentEntry[] {
  if (!session) {
    return []
  }
  const codexHome = getCodexHome(env)
  const key = `${codexHome}:${session.id}`
  if (cache?.key === key && now.getTime() - cache.at < CACHE_MS) {
    return structuredClone(cache.agents)
  }

  const runtimes = listSessionCandidates(codexHome)
    .filter(candidate => isSubagentSource(candidate.source) && candidate.parentThreadId)
    .flatMap((candidate) => {
      const runtime = parseAgent(candidate, now)
      return runtime ? [runtime] : []
    })
  const tree = descendants(session.id, runtimes)
  const childrenByParent = new Map<string, AgentRuntime[]>()
  for (const runtime of tree) {
    const siblings = childrenByParent.get(runtime.parentThreadId) ?? []
    siblings.push(runtime)
    childrenByParent.set(runtime.parentThreadId, siblings)
  }

  const direct = childrenByParent.get(session.id) ?? []
  const agents = direct.map((runtime) => {
    let activeDescendantCount = 0
    const queue = [...(childrenByParent.get(runtime.entry.id) ?? [])]
    while (queue.length > 0) {
      const child = queue.shift()!
      if (child.active || child.entry.status === 'starting') {
        activeDescendantCount += 1
      }
      queue.push(...(childrenByParent.get(child.entry.id) ?? []))
    }
    return { ...runtime.entry, activeDescendantCount }
  })
  cache = { key, at: now.getTime(), agents }
  return structuredClone(agents)
}
