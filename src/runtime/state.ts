// @env node
import type { ParsedRolloutState } from '../codex/rollout-parser.js'
import type { CodexProcess } from '../collectors/session-metadata.js'
import type { HudConfig } from '../types/config.js'
import type { HudState, UsageData } from '../types/state.js'
import process from 'node:process'
import { resolveUsageData } from '../codex/external-usage.js'
import { trustedUsageDataForEndpoint } from '../codex/rate-limits.js'
import {
  collectAgentEntries,
  collectAuthInfo,
  collectGitStatus,
  collectMemoryInfo,
  collectProjectInfo,
  collectSessionTitle,
} from '../collectors/index.js'

export function buildHudState(
  cwd: string,
  rollout: ParsedRolloutState,
  sessionStart: Date,
  config: HudConfig,
  now = new Date(),
  codexProcess: CodexProcess | null = null,
  loggedUsage: UsageData | null = null,
  queriedUsage: UsageData | null = null,
  endpoint: string | null = null,
): HudState {
  const workspaceRoots = rollout.session?.workspaceRoots ?? []
  const usage = resolveUsageData(
    trustedUsageDataForEndpoint(endpoint, rollout.usage, loggedUsage),
    config.display,
    now,
  )
  const title = config.display.showSessionName ? collectSessionTitle(rollout.session) : null
  const session = rollout.session
    ? { ...rollout.session, sessionName: title ?? rollout.session.sessionName }
    : null
  const auth = config.display.showAuth ? collectAuthInfo(usage?.planType ?? null, session, process.env, codexProcess) : null
  return {
    session,
    project: collectProjectInfo(cwd, workspaceRoots, process.env, config.display.showConfigCounts),
    git: config.gitStatus.enabled ? collectGitStatus(cwd) : null,
    context: rollout.context,
    usage,
    sessionTokens: rollout.sessionTokens,
    tools: rollout.tools,
    images: rollout.images,
    skills: rollout.skills,
    mcpServers: rollout.mcpServers,
    agents: config.display.showAgents ? collectAgentEntries(session) : [],
    todos: rollout.todos,
    goal: rollout.goal,
    conversationTurns: rollout.conversationTurns,
    compactCount: rollout.compactCount,
    memory: config.display.showMemoryUsage ? collectMemoryInfo() : null,
    auth: auth && queriedUsage?.balanceLabel ? { ...auth, balanceLabel: queriedUsage.balanceLabel } : auth,
    sessionStart: session?.startTime ?? sessionStart,
  }
}
