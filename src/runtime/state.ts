// @env node
import type { ParsedRolloutState } from '../codex/rollout-parser.js'
import type { HudConfig } from '../types/config.js'
import type { HudState } from '../types/state.js'
import process from 'node:process'
import { resolveUsageData } from '../codex/external-usage.js'
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
): HudState {
  const workspaceRoots = rollout.session?.workspaceRoots ?? []
  const usage = resolveUsageData(rollout.usage, config.display, now)
  const title = config.display.showSessionName ? collectSessionTitle(rollout.session) : null
  const session = rollout.session
    ? { ...rollout.session, sessionName: title ?? rollout.session.sessionName }
    : null
  return {
    session,
    project: collectProjectInfo(cwd, workspaceRoots, process.env, config.display.showConfigCounts),
    git: config.gitStatus.enabled ? collectGitStatus(cwd) : null,
    context: rollout.context,
    usage,
    sessionTokens: rollout.sessionTokens,
    tools: rollout.tools,
    skills: rollout.skills,
    mcpServers: rollout.mcpServers,
    agents: config.display.showAgents ? collectAgentEntries(session) : [],
    todos: rollout.todos,
    goal: rollout.goal,
    compactCount: rollout.compactCount,
    memory: config.display.showMemoryUsage ? collectMemoryInfo() : null,
    auth: config.display.showAuth ? collectAuthInfo(usage?.planType ?? null) : null,
    sessionStart: session?.startTime ?? sessionStart,
  }
}
