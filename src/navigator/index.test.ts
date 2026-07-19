import type { ConversationTurn } from '../types/state.js'
import { describe, expect, it } from 'vitest'
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
    expect(list.join('\n')).toContain('Add a HUD conversation navigator.')
    expect(list).toHaveLength(4)

    state.view = 'detail'
    const detail = renderNavigator(turns, state, {
      width: 40,
      height: 9,
      color: false,
      language: 'en',
    })
    expect(detail.join('\n')).toContain('User · #2')
    expect(detail.join('\n')).toContain('Assistant')
    expect(detail.length).toBeLessThanOrEqual(9)
  })
})
