import type { HudState } from '../types/state.js'
import { describe, expect, it } from 'vitest'
import { createPreset } from '../config/presets.js'
import { visibleWidth } from './format.js'
import { renderHud } from './index.js'

const now = new Date('2026-07-16T09:00:00Z')

function state(): HudState {
  return {
    session: {
      id: '019f6a4a-3f79-7ae1-b439-9ea460899c97',
      rolloutPath: '/tmp/rollout.jsonl',
      startTime: new Date('2026-07-16T08:00:00Z'),
      cwd: '/work/codex-hud',
      cliVersion: '0.144.1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      modelProvider: 'openai',
      approvalPolicy: 'on-request',
      permissionProfile: 'workspace-write',
      sandboxMode: 'workspace-write',
      collaborationMode: 'default',
      lastResponseAt: new Date('2026-07-16T08:59:30Z'),
      outputTokensPerSecond: 42.15,
      sessionName: 'HUD fidelity audit',
    },
    project: {
      cwd: '/work/codex-hud',
      projectRoot: '/work/codex-hud',
      projectName: 'codex-hud',
      workspaceRoots: ['/work/codex-hud', '/work/shared'],
      agentsMdCount: 2,
      codexConfigCount: 2,
      rulesCount: 3,
      hooksCount: 4,
      skillsCount: 5,
      pluginsCount: 1,
      mcpCount: 2,
    },
    git: {
      isGitRepo: true,
      branch: 'main',
      isDirty: true,
      ahead: 1,
      behind: 0,
      modified: 2,
      added: 1,
      deleted: 0,
      untracked: 1,
    },
    context: {
      used: 68_000,
      total: 116_000,
      percent: 59,
      remainingPercent: 41,
      inputTokens: 20_000,
      outputTokens: 10_000,
      cachedTokens: 50_000,
    },
    usage: {
      primary: { label: '5h', percent: 25, resetAt: new Date('2026-07-16T10:30:00Z'), windowMinutes: 300 },
      secondary: { label: '1w', percent: 82, resetAt: new Date('2026-07-20T09:00:00Z'), windowMinutes: 10_080 },
      individual: null,
      planType: 'pro',
      balanceLabel: '$12.50',
      limitReachedType: null,
    },
    sessionTokens: {
      inputTokens: 50_000,
      outputTokens: 5_000,
      reasoningOutputTokens: 2_000,
      cachedInputTokens: 30_000,
      cacheWriteInputTokens: 1_000,
      totalTokens: 55_000,
    },
    tools: [
      { id: '1', name: 'exec_command', target: 'pnpm test', status: 'running', startTime: new Date('2026-07-16T08:59:55Z') },
      { id: '2', name: 'view_image', status: 'completed', startTime: new Date('2026-07-16T08:55:00Z'), endTime: new Date('2026-07-16T08:55:01Z') },
    ],
    skills: ['openai-docs', 'plugin-creator'],
    mcpServers: ['github'],
    agents: [
      { id: 'agent-1', type: 'explorer', description: 'Inspect protocol', status: 'running', startTime: new Date('2026-07-16T08:58:00Z') },
    ],
    todos: [
      { content: 'Parse rollout', status: 'completed' },
      { content: 'Render HUD', status: 'in_progress' },
      { content: 'Verify', status: 'pending' },
    ],
    goal: { objective: 'Build Codex HUD', status: 'active', tokensUsed: 12_000, tokenBudget: 500_000 },
    conversationTurns: [
      {
        id: 'turn-1',
        turnId: 'turn-1',
        startedAt: new Date('2026-07-16T08:10:00Z'),
        userMessage: 'Add a persistent HUD below Codex.',
        assistantMessage: 'Implemented the HUD renderer.',
        assistantPhase: 'final_answer',
      },
    ],
    compactCount: 1,
    memory: { totalBytes: 100, usedBytes: 60, freeBytes: 40, usedPercent: 60 },
    auth: { method: 'ChatGPT pro', user: 'builder' },
    sessionStart: new Date('2026-07-16T08:00:00Z'),
  }
}

describe('hud renderer', () => {
  it('renders the full expanded Codex HUD', () => {
    const config = createPreset('full')
    config.gitStatus.showAheadBehind = true
    const lines = renderHud({
      config,
      state: state(),
      options: { width: 180, height: 20, color: false },
      now,
    })

    expect(lines).toMatchSnapshot()
    expect(lines[0]).toContain('[gpt-5.5 high]')
    expect(lines[0]).toContain('codex-hud +shared git:(main* ↑1)')
    expect(lines[0]).not.toContain('+shared │ git:')
    expect(lines[0]).not.toContain('HUD fidelity audit')
    expect(lines.join('\n')).not.toContain('Memory')
    expect(lines.join('\n')).not.toContain('configs')
    expect(lines.join('\n')).not.toContain('Started')
  })

  it('keeps long goals compact at screenshot width', () => {
    const value = state()
    value.goal = { objective: 'Build a very long goal '.repeat(20), status: 'active' }
    value.todos = []
    const lines = renderHud({
      config: createPreset('full'),
      state: value,
      options: { width: 100, height: 12, color: false },
      now,
    })
    const goal = lines.find(line => line.includes('Goal:'))
    expect(goal).toBeDefined()
    expect(visibleWidth(goal!)).toBeLessThanOrEqual(75)
    expect(goal).toContain('…')
  })

  it('renders a compact one-line identity with activity below it', () => {
    const config = createPreset('minimal')
    config.display.showTools = true
    const lines = renderHud({
      config,
      state: state(),
      options: { width: 100, height: 4, color: false },
      now,
    })

    expect(lines[0]).toContain('[gpt-5.5]')
    expect(lines[0]).toContain('Context')
    expect(lines[1]).toContain('Tools:')
  })

  it('clips lines to terminal width', () => {
    const lines = renderHud({
      config: createPreset('full'),
      state: state(),
      options: { width: 24, height: 3, color: false },
      now,
    })
    expect(lines).toHaveLength(3)
    expect(lines.every(line => visibleWidth(line) <= 24)).toBe(true)
    expect(lines.join('\n')).not.toContain('\u001B')
  })

  it('renders prompt cache, inline added directories, git file stats, auth, title, speed, and compact window overrides', () => {
    const config = createPreset('full')
    Object.assign(config.display, {
      showPromptCache: true,
      showSessionName: true,
      showAuth: true,
      showAuthUser: true,
      showSpeed: true,
      autoCompactWindow: 80_000,
    })
    config.gitStatus.showFileStats = true
    const lines = renderHud({ config, state: state(), options: { width: 220, height: 20, color: false }, now })
    expect(lines.join('\n')).toContain('+shared')
    expect(lines.join('\n')).toContain('!2 +1 ?1')
    expect(lines.join('\n')).toContain('Cache TTL ⏱️ 5m')
    expect(lines.join('\n')).toContain('Context ██████████ 100%')
    expect(lines[0]).toContain('HUD fidelity audit')
    expect(lines.join('\n')).toContain('ChatGPT pro (builder)')
    expect(lines.join('\n')).toContain('out: 42.1 tok/s')
  })
})
