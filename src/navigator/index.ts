import type { Language } from '../types/config.js'
import type { ConversationTurn } from '../types/state.js'
import sliceAnsi from 'slice-ansi'
import { truncateAnsi, visibleWidth } from '../render/format.js'
import { HUD_VERSION } from '../version.js'

export interface NavigatorState {
  active: boolean
  view: 'list' | 'detail'
  selectedIndex: number
  query: string
  searchMode: boolean
  detailScroll: number
  copyStatus: 'idle' | 'copied' | 'failed'
}

export interface NavigatorRenderOptions {
  width: number
  height: number
  color: boolean
  language: Language
  sessionId?: string | null
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
    listHelp: 'j/k move · Enter open · / search · y copy ID · q/Esc close',
    detailHelp: 'j/k scroll · h/←/Esc list · y copy ID · q close',
    copy: '⧉  y',
    copied: '✓ copied',
    copyFailed: '! copy failed',
  },
  'zh-Hans': {
    title: '会话历史导航',
    turns: '轮',
    search: '搜索',
    noMatches: '没有匹配的用户输入',
    user: '用户',
    assistant: '助手',
    waiting: '正在等待回复…',
    listHelp: 'j/k 选择 · Enter 查看 · / 搜索 · y 复制 ID · q/Esc 关闭',
    detailHelp: 'j/k 滚动 · h/←/Esc 返回 · y 复制 ID · q 关闭',
    copy: '⧉  y',
    copied: '✓ 已复制',
    copyFailed: '! 复制失败',
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
    copyStatus: 'idle',
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

function renderListItem(
  turn: ConversationTurn,
  index: number,
  selected: boolean,
  width: number,
  color: boolean,
): string[] {
  const prefix = `#${String(index + 1).padStart(2, '0')} ${timeLabel(turn.startedAt)} `
  const prefixWidth = visibleWidth(prefix)
  const messageWidth = Math.max(1, width - prefixWidth)
  const indent = ' '.repeat(prefixWidth)
  return wrapText(turn.userMessage, messageWidth).map((line, lineIndex) => {
    const content = `${lineIndex === 0 ? prefix : indent}${line}`
    const row = padLine(content, width)
    return selected ? inverse(row, color) : row
  })
}

function visibleListItems(
  items: Array<{ index: number, lines: string[] }>,
  selectedPosition: number,
  lineBudget: number,
): string[] {
  const selected = items[selectedPosition]
  if (!selected) {
    return []
  }
  if (selected.lines.length >= lineBudget) {
    return selected.lines.slice(0, lineBudget)
  }

  let start = selectedPosition
  let end = selectedPosition + 1
  let used = selected.lines.length
  const beforeTarget = Math.floor((lineBudget - used) / 2)
  let beforeUsed = 0
  while (start > 0) {
    const candidate = items[start - 1]
    if (!candidate || beforeUsed + candidate.lines.length > beforeTarget) {
      break
    }
    start -= 1
    beforeUsed += candidate.lines.length
    used += candidate.lines.length
  }
  while (end < items.length) {
    const candidate = items[end]
    if (!candidate || used + candidate.lines.length > lineBudget) {
      break
    }
    end += 1
    used += candidate.lines.length
  }
  while (start > 0) {
    const candidate = items[start - 1]
    if (!candidate || used + candidate.lines.length > lineBudget) {
      break
    }
    start -= 1
    used += candidate.lines.length
  }
  return items.slice(start, end).flatMap(item => item.lines).slice(0, lineBudget)
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function navigatorHeader(
  title: string,
  state: NavigatorState,
  options: NavigatorRenderOptions,
): string {
  if (!options.sessionId) {
    return `${title} · HUD v${HUD_VERSION}`
  }
  const labels = LABELS[options.language]
  const copy = state.copyStatus === 'copied'
    ? labels.copied
    : state.copyStatus === 'failed'
      ? labels.copyFailed
      : labels.copy
  return `${options.sessionId} [${copy}] · ${title} · HUD v${HUD_VERSION}`
}

function fitNavigatorHeader(value: string, width: number): string {
  if (visibleWidth(value) <= width) {
    return value
  }
  const versionSeparator = ` · HUD v${HUD_VERSION}`
  const withoutVersion = value.endsWith(versionSeparator)
    ? value.slice(0, -versionSeparator.length)
    : value
  return truncateAnsi(withoutVersion, width)
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
  const header = navigatorHeader(
    `${labels.title} · ${String(turns.length)} ${labels.turns}`,
    state,
    options,
  )
  const search = state.searchMode || state.query
    ? `${labels.search}: ${state.query}${state.searchMode ? '█' : ''}`
    : ''
  const reserved = search ? 3 : 2
  const lineBudget = Math.max(1, height - reserved)
  const selectedPosition = Math.max(0, matches.indexOf(state.selectedIndex))
  const lines = [fitNavigatorHeader(header, width)]
  if (search) {
    lines.push(truncateAnsi(search, width))
  }
  if (matches.length === 0) {
    lines.push(labels.noMatches)
  }
  else {
    const items = matches.map(index => ({
      index,
      lines: renderListItem(turns[index], index, index === state.selectedIndex, width, options.color),
    }))
    lines.push(...visibleListItems(items, selectedPosition, lineBudget))
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
  const header = navigatorHeader(
    `${labels.title} · #${String(state.selectedIndex + 1)}/${String(turns.length)}`,
    state,
    options,
  )
  return [
    fitNavigatorHeader(header, width),
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
