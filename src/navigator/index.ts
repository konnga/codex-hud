import type { Language } from '../types/config.js'
import type { ConversationTurn } from '../types/state.js'
import sliceAnsi from 'slice-ansi'
import { safeText, truncateAnsi, visibleWidth } from '../render/format.js'

export interface NavigatorState {
  active: boolean
  view: 'list' | 'detail'
  selectedIndex: number
  query: string
  searchMode: boolean
  detailScroll: number
}

export interface NavigatorRenderOptions {
  width: number
  height: number
  color: boolean
  language: Language
}

const LABELS = {
  'en': {
    title: 'Conversation navigator',
    turns: 'turns',
    search: 'Search',
    noMatches: 'No matching user messages',
    user: 'User',
    assistant: 'Assistant',
    waiting: 'Waiting for a response…',
    listHelp: 'j/k move · Enter open · / search · q/Esc close',
    detailHelp: 'j/k scroll · h/←/Esc list · q close',
  },
  'zh-Hans': {
    title: '会话历史导航',
    turns: '轮',
    search: '搜索',
    noMatches: '没有匹配的用户输入',
    user: '用户',
    assistant: '助手',
    waiting: '正在等待回复…',
    listHelp: 'j/k 选择 · Enter 查看 · / 搜索 · q/Esc 关闭',
    detailHelp: 'j/k 滚动 · h/←/Esc 返回 · q 关闭',
  },
  'zh-Hant': {
    title: '會話歷史導航',
    turns: '輪',
    search: '搜尋',
    noMatches: '沒有符合的使用者輸入',
    user: '使用者',
    assistant: '助手',
    waiting: '正在等待回應…',
    listHelp: 'j/k 選擇 · Enter 查看 · / 搜尋 · q/Esc 關閉',
    detailHelp: 'j/k 捲動 · h/←/Esc 返回 · q 關閉',
  },
} as const

export function createNavigatorState(): NavigatorState {
  return {
    active: false,
    view: 'list',
    selectedIndex: 0,
    query: '',
    searchMode: false,
    detailScroll: 0,
  }
}

const KEY_SEQUENCES = [
  '\u001B[A',
  '\u001B[B',
  '\u001B[C',
  '\u001B[D',
  '\u001B[5~',
  '\u001B[6~',
]

export function splitNavigatorInput(value: string): string[] {
  const result: string[] = []
  let remaining = value
  while (remaining) {
    const sequence = KEY_SEQUENCES.find(candidate => remaining.startsWith(candidate))
    if (sequence) {
      result.push(sequence)
      remaining = remaining.slice(sequence.length)
      continue
    }
    const character = Array.from(remaining)[0]
    if (!character) {
      break
    }
    result.push(character)
    remaining = remaining.slice(character.length)
  }
  return result
}

export function matchingTurnIndices(turns: ConversationTurn[], query: string): number[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) {
    return turns.map((_turn, index) => index)
  }
  return turns.flatMap((turn, index) => {
    const haystack = `${turn.userMessage}\n${turn.assistantMessage}`.toLocaleLowerCase()
    return haystack.includes(normalized) ? [index] : []
  })
}

export function normalizeNavigatorSelection(state: NavigatorState, turns: ConversationTurn[]): number[] {
  const matches = matchingTurnIndices(turns, state.query)
  if (matches.length === 0) {
    state.selectedIndex = 0
    return matches
  }
  if (!matches.includes(state.selectedIndex)) {
    state.selectedIndex = matches.at(-1) ?? 0
  }
  return matches
}

function sanitizeMultiline(value: string): string[] {
  return value.replace(/\r/g, '').split('\n').map(line => Array.from(line, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('').trimEnd())
}

function wrapLine(value: string, width: number): string[] {
  if (!value) {
    return ['']
  }
  const lines: string[] = []
  let remaining = value
  while (visibleWidth(remaining) > width) {
    const part = sliceAnsi(remaining, 0, width)
    lines.push(part)
    remaining = sliceAnsi(remaining, width)
  }
  lines.push(remaining)
  return lines
}

function wrapText(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width)
  return sanitizeMultiline(value).flatMap(line => wrapLine(line, safeWidth))
}

function inverse(value: string, enabled: boolean): string {
  return enabled ? `\u001B[7m${value}\u001B[0m` : `> ${value}`
}

function padLine(value: string, width: number): string {
  const truncated = truncateAnsi(value, width)
  return `${truncated}${' '.repeat(Math.max(0, width - visibleWidth(truncated)))}`
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function renderList(
  turns: ConversationTurn[],
  state: NavigatorState,
  options: NavigatorRenderOptions,
): string[] {
  const labels = LABELS[options.language]
  const width = Math.max(20, options.width)
  const height = Math.max(5, options.height)
  const matches = normalizeNavigatorSelection(state, turns)
  const header = `${labels.title} · ${String(turns.length)} ${labels.turns}`
  const search = state.searchMode || state.query
    ? `${labels.search}: ${state.query}${state.searchMode ? '█' : ''}`
    : ''
  const reserved = search ? 3 : 2
  const rowCount = Math.max(1, height - reserved)
  const selectedPosition = Math.max(0, matches.indexOf(state.selectedIndex))
  const start = Math.max(0, Math.min(
    selectedPosition - Math.floor(rowCount / 2),
    matches.length - rowCount,
  ))
  const visible = matches.slice(start, start + rowCount)
  const lines = [truncateAnsi(header, width)]
  if (search) {
    lines.push(truncateAnsi(search, width))
  }
  if (visible.length === 0) {
    lines.push(labels.noMatches)
  }
  else {
    for (const index of visible) {
      const turn = turns[index]
      const prefix = `#${String(index + 1).padStart(2, '0')} ${timeLabel(turn.startedAt)} `
      const summary = `${prefix}${safeText(turn.userMessage)}`
      const row = padLine(summary, width)
      lines.push(index === state.selectedIndex ? inverse(row, options.color) : row)
    }
  }
  lines.push(truncateAnsi(labels.listHelp, width))
  return lines.slice(0, height)
}

function renderDetail(
  turns: ConversationTurn[],
  state: NavigatorState,
  options: NavigatorRenderOptions,
): string[] {
  const labels = LABELS[options.language]
  const width = Math.max(20, options.width)
  const height = Math.max(5, options.height)
  const turn = turns[state.selectedIndex]
  if (!turn) {
    state.view = 'list'
    return renderList(turns, state, options)
  }
  const body = [
    `${labels.user} · #${String(state.selectedIndex + 1)} · ${timeLabel(turn.startedAt)}`,
    ...wrapText(turn.userMessage, width),
    '',
    labels.assistant,
    ...wrapText(turn.assistantMessage || labels.waiting, width),
  ]
  const bodyHeight = Math.max(1, height - 2)
  const maximumScroll = Math.max(0, body.length - bodyHeight)
  const scroll = Math.min(maximumScroll, Math.max(0, state.detailScroll))
  state.detailScroll = scroll
  const header = `${labels.title} · #${String(state.selectedIndex + 1)}/${String(turns.length)}`
  return [
    truncateAnsi(header, width),
    ...body.slice(scroll, scroll + bodyHeight).map(line => truncateAnsi(line, width)),
    truncateAnsi(labels.detailHelp, width),
  ].slice(0, height)
}

export function renderNavigator(
  turns: ConversationTurn[],
  state: NavigatorState,
  options: NavigatorRenderOptions,
): string[] {
  return state.view === 'detail'
    ? renderDetail(turns, state, options)
    : renderList(turns, state, options)
}
