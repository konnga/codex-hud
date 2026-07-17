import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateContextUsage } from './context-usage.js'
import { JsonlTail } from './jsonl-tail.js'
import { RolloutParser } from './rollout-parser.js'

const fixturePath = path.resolve('tests/fixtures/session-active.jsonl')
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('codex context usage', () => {
  it('matches the official 12k baseline calculation', () => {
    expect(calculateContextUsage({
      input_tokens: 70_000,
      cached_input_tokens: 50_000,
      output_tokens: 10_000,
      total_tokens: 80_000,
    }, 128_000)).toEqual({
      used: 68_000,
      total: 116_000,
      percent: 59,
      remainingPercent: 41,
      inputTokens: 20_000,
      outputTokens: 10_000,
      cachedTokens: 50_000,
    })
  })
})

describe('jSONL tailing', () => {
  it('retains partial lines until the newline arrives', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-jsonl-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'rollout.jsonl')
    fs.writeFileSync(filePath, '{"a":1}\n{"b":', 'utf8')
    const tail = new JsonlTail()
    expect(tail.read(filePath).lines).toEqual(['{"a":1}'])
    fs.appendFileSync(filePath, '2}\n', 'utf8')
    expect(tail.read(filePath).lines).toEqual(['{"b":2}'])
  })
})

describe('rollout parser', () => {
  it('normalizes session, activity, plan, goal, tokens, and limits', () => {
    const parser = new RolloutParser()
    parser.setFile(fixturePath)
    const state = parser.parse()

    expect(state.session).toMatchObject({
      id: 'root-session',
      cwd: '/work/demo',
      cliVersion: '0.144.1',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      collaborationMode: 'default',
      lastTurnDurationMs: 10_000,
      timeToFirstTokenMs: 350,
      outputTokensPerSecond: expect.any(Number),
    })
    expect(state.context).toMatchObject({ percent: 59, remainingPercent: 41 })
    expect(state.sessionTokens).toEqual({
      inputTokens: 50_000,
      outputTokens: 5_000,
      reasoningOutputTokens: 2_000,
      cachedInputTokens: 30_000,
      cacheWriteInputTokens: 1_000,
      totalTokens: 55_000,
    })
    expect(state.usage).toMatchObject({
      primary: { label: '5h', percent: 25 },
      secondary: { label: '1w', percent: 82 },
      individual: { label: 'spend', percent: 20 },
      planType: 'pro',
      balanceLabel: '$12.50',
    })
    expect(state.tools).toHaveLength(2)
    expect(state.tools[0]).toMatchObject({ name: 'exec_command', status: 'completed' })
    expect(state.tools[1]).toMatchObject({ name: 'mcp__github__search_code', status: 'error', target: 'statusline' })
    expect(state.mcpServers).toEqual(['github'])
    expect(state.todos).toEqual([
      { content: 'Parse rollout', status: 'completed' },
      { content: 'Render HUD', status: 'in_progress' },
      { content: 'Verify', status: 'pending' },
    ])
    expect(state.goal).toEqual({
      objective: 'Build Codex HUD',
      status: 'active',
      tokenBudget: 500_000,
      tokensUsed: 12_000,
      timeUsedSeconds: 420,
    })
    expect(state.compactCount).toBe(1)
  })

  it('parses only appended records after the initial pass', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-rollout-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'rollout.jsonl')
    fs.copyFileSync(fixturePath, filePath)
    const parser = new RolloutParser()
    parser.setFile(filePath)
    expect(parser.parse().compactCount).toBe(1)
    fs.appendFileSync(filePath, '{"timestamp":"2026-07-16T08:01:00Z","type":"event_msg","payload":{"type":"context_compacted"}}\n')
    expect(parser.parse().compactCount).toBe(2)
  })

  it('suppresses implausible output-speed samples', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-rollout-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'rollout.jsonl')
    fs.copyFileSync(fixturePath, filePath)
    fs.appendFileSync(filePath, [
      JSON.stringify({ timestamp: '2026-07-16T08:02:00Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'fast' } }),
      JSON.stringify({ timestamp: '2026-07-16T08:02:01Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { output_tokens: 100_000 } } } }),
      JSON.stringify({ timestamp: '2026-07-16T08:02:02Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'fast', duration_ms: 1_000, time_to_first_token_ms: 100 } }),
      '',
    ].join('\n'))
    const parser = new RolloutParser()
    parser.setFile(filePath)
    expect(parser.parse().session?.outputTokensPerSecond).toBeUndefined()
  })
})
