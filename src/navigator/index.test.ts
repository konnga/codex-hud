import type { ConversationTurn } from '../types/state.js'
import { describe, expect, it } from 'vitest'
import { HUD_VERSION } from '../version.js'
import {
  createNavigatorState,
  matchingTurnIndices,
  normalizeNavigatorSelection,
  renderNavigator,
  splitNavigatorInput,
} from './index.js'

const turns: ConversationTurn[] = [
  {
    id: 'turn-1',
    turnId: 'turn-1',
    startedAt: new Date('2026-07-18T10:00:00Z'),
    userMessage: 'Why does Codex use the alternate screen?',
    assistantMessage: 'It prioritizes a stable full-screen TUI.',
    assistantPhase: 'final_answer',
  },
  {
    id: 'turn-2',
    turnId: 'turn-2',
    startedAt: new Date('2026-07-18T10:05:00Z'),
    userMessage: 'Add a HUD conversation navigator.',
    assistantMessage: 'The HUD can expand into a terminal-native viewer.',
    assistantPhase: 'final_answer',
  },
]

describe('conversation navigator', () => {
  it('filters both user and assistant text', () => {
    expect(matchingTurnIndices(turns, 'alternate')).toEqual([0])
    expect(matchingTurnIndices(turns, 'terminal-native')).toEqual([1])
    expect(matchingTurnIndices(turns, '')).toEqual([0, 1])
  })

  it('splits combined terminal input while preserving escape sequences', () => {
    expect(splitNavigatorInput(`k\r\u001B[A你`)).toEqual(['k', '\r', '\u001B[A', '你'])
  })

  it('moves an invalid selection to the latest matching turn', () => {
    const state = createNavigatorState()
    state.selectedIndex = 0
    state.query = 'navigator'
    expect(normalizeNavigatorSelection(state, turns)).toEqual([1])
    expect(state.selectedIndex).toBe(1)
  })

  it('renders list and detail views within the viewport', () => {
    const state = createNavigatorState()
    state.active = true
    state.selectedIndex = 1
    const list = renderNavigator(turns, state, {
      width: 60,
      height: 8,
      color: false,
      language: 'en',
    })
    expect(list.join('\n')).toContain('Conversation navigator · 2 turns')
    expect(list.join('\n')).toContain(`HUD v${HUD_VERSION}`)
    expect(list.join('\n')).toContain('Add a HUD conversation navigator.')
    expect(list).toHaveLength(4)

    state.view = 'detail'
    const detail = renderNavigator(turns, state, {
      width: 60,
      height: 9,
      color: false,
      language: 'en',
    })
    expect(detail.join('\n')).toContain('User · #2')
    expect(detail.join('\n')).toContain('Assistant')
    expect(detail.join('\n')).toContain(`HUD v${HUD_VERSION}`)
    expect(detail.length).toBeLessThanOrEqual(9)
  })

  it('wraps multiline user messages in the list view', () => {
    const state = createNavigatorState()
    state.active = true
    state.selectedIndex = 0
    const multilineTurns: ConversationTurn[] = [{
      ...turns[0],
      userMessage: 'First line\nSecond line stays visible.',
    }]

    const list = renderNavigator(multilineTurns, state, {
      width: 32,
      height: 8,
      color: true,
      language: 'en',
    })

    expect(list.join('\n')).toContain('First line')
    expect(list.join('\n')).toContain('Second line stays')
    expect(list.at(-1)).toContain('j/k move')
    expect(list).toHaveLength(5)
  })

  it('renders a session ID copy shortcut and feedback in both views', () => {
    const state = createNavigatorState()
    state.active = true
    state.selectedIndex = 1
    const options = {
      width: 100,
      height: 8,
      color: false,
      language: 'zh-Hans' as const,
      sessionId: '0198d28f-62d0-7d50-bf89-f769647faa12',
    }

    const list = renderNavigator(turns, state, options)
    expect(list[0]).toContain('0198d28f-62d0-7d50-bf89-f769647faa12 [⧉  y]')
    expect(list.at(-1)).toContain('y 复制 ID')

    state.copyStatus = 'copied'
    state.view = 'detail'
    const detail = renderNavigator(turns, state, options)
    expect(detail[0]).toContain('0198d28f-62d0-7d50-bf89-f769647faa12 [✓ 已复制]')
    expect(detail.at(-1)).toContain('y 复制 ID')
  })

  it('drops the version before truncating a narrow navigator header', () => {
    const state = createNavigatorState()
    state.active = true
    const list = renderNavigator(turns, state, {
      width: 30,
      height: 6,
      color: false,
      language: 'en',
      sessionId: '0198d28f-62d0-7d50-bf89-f769647faa12',
    })

    expect(list[0]).not.toContain('HUD v')
    expect(list[0]).toContain('0198d28f')
  })
})
