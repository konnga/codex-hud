import type { HudElement } from '../types/config.js'
import type { RenderContext } from '../types/render.js'
import {
  renderAgentsLine,
  renderMcpLine,
  renderSkillsLine,
  renderTodosLine,
  renderToolsLine,
} from './activity-lines.js'
import { renderContextLine } from './context-line.js'
import { renderEnvironmentLine, renderMemoryLine } from './environment-line.js'
import { truncateAnsi, visibleWidth } from './format.js'
import { renderAddedDirsLine, renderProjectLine } from './project-line.js'
import { renderPromptCacheLine } from './prompt-cache-line.js'
import { renderSessionLine } from './session-line.js'
import { renderTurnsLine } from './turns-line.js'
import { renderUsageLine } from './usage-line.js'

function renderElement(ctx: RenderContext, element: HudElement): string | null {
  switch (element) {
    case 'project': return renderProjectLine(ctx)
    case 'addedDirs': return renderAddedDirsLine(ctx)
    case 'context': return renderContextLine(ctx)
    case 'usage': return renderUsageLine(ctx)
    case 'memory': return renderMemoryLine(ctx)
    case 'environment': return renderEnvironmentLine(ctx)
    case 'tools': return renderToolsLine(ctx)
    case 'skills': return renderSkillsLine(ctx)
    case 'mcp': return renderMcpLine(ctx)
    case 'agents': return renderAgentsLine(ctx)
    case 'todos': return renderTodosLine(ctx)
    case 'turns': return renderTurnsLine(ctx)
    case 'sessionTime': return renderSessionLine(ctx)
    case 'promptCache': return renderPromptCacheLine(ctx)
  }
}

function mergeLookup(groups: HudElement[][]): Map<HudElement, Set<HudElement>> {
  const result = new Map<HudElement, Set<HudElement>>()
  for (const group of groups) {
    const set = new Set(group)
    group.forEach(element => result.set(element, set))
  }
  return result
}

function expandedLines(ctx: RenderContext): string[] {
  const lines: string[] = []
  const seen = new Set<HudElement>()
  const lookup = mergeLookup(ctx.config.display.mergeGroups)
  for (let index = 0; index < ctx.config.elementOrder.length; index += 1) {
    const element = ctx.config.elementOrder[index]
    if (seen.has(element)) {
      continue
    }
    const group = lookup.get(element)
    if (group) {
      const sequence: HudElement[] = []
      for (let next = index; next < ctx.config.elementOrder.length; next += 1) {
        const candidate = ctx.config.elementOrder[next]
        if (!group.has(candidate) || seen.has(candidate)) {
          break
        }
        sequence.push(candidate)
      }
      if (sequence.length > 1) {
        sequence.forEach(item => seen.add(item))
        index += sequence.length - 1
        const rendered = sequence.map(item => renderElement(ctx, item)).filter((line): line is string => Boolean(line))
        const combined = rendered.join(' │ ')
        if (rendered.length > 1 && visibleWidth(combined) <= ctx.options.width) {
          lines.push(combined)
        }
        else {
          lines.push(...rendered)
        }
        continue
      }
    }
    seen.add(element)
    const line = renderElement(ctx, element)
    if (line) {
      lines.push(...line.split('\n'))
    }
  }
  return lines
}

function compactLines(ctx: RenderContext): string[] {
  const rendered = [
    renderProjectLine(ctx),
    renderContextLine(ctx),
    renderUsageLine(ctx),
    renderPromptCacheLine(ctx),
    renderEnvironmentLine(ctx),
    renderSessionLine(ctx),
  ]
    .filter((line): line is string => Boolean(line))
  const lines: string[] = []
  const overflow: string[] = []
  for (const value of rendered) {
    const [first, ...rest] = value.split('\n')
    if (first)
      lines.push(first)
    overflow.push(...rest.filter(Boolean))
  }
  const combined = lines.join(' │ ')
  const activity = [
    renderMemoryLine(ctx),
    renderToolsLine(ctx),
    renderSkillsLine(ctx),
    renderMcpLine(ctx),
    renderAgentsLine(ctx),
    renderTodosLine(ctx),
    renderTurnsLine(ctx),
  ]
    .filter((line): line is string => Boolean(line))
    .flatMap(line => line.split('\n'))
  return [combined, ...overflow, ...activity].filter(Boolean)
}

export function renderHud(ctx: RenderContext): string[] {
  let lines = ctx.config.lineLayout === 'compact' ? compactLines(ctx) : expandedLines(ctx)
  if (ctx.config.display.customLine) {
    lines = ctx.config.display.customLinePosition === 'first'
      ? [ctx.config.display.customLine, ...lines]
      : [...lines, ctx.config.display.customLine]
  }
  if (ctx.config.showSeparators && lines.length > 2) {
    lines.splice(2, 0, '─'.repeat(Math.min(ctx.options.width, Math.max(20, visibleWidth(lines[0] ?? '')))))
  }
  const height = Math.max(1, ctx.options.height)
  return lines.slice(0, height).map(line => truncateAnsi(line, ctx.options.width))
}
