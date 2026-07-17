import type { RenderContext } from '../types/render.js'
import type { AgentEntry } from '../types/state.js'
import { color } from './colors.js'
import { formatDuration, safeText, truncateAnsi } from './format.js'
import { icon, message } from './i18n.js'

function elapsed(agent: AgentEntry, now: Date): string {
  return formatDuration((agent.endTime ?? now).getTime() - agent.startTime.getTime())
}

function toolName(ctx: RenderContext, value: string): string {
  const maximum = ctx.config.display.toolNameMaxLength
  if (maximum <= 0 || value.length <= maximum) {
    return value
  }
  const mcpLeaf = value.startsWith('mcp__') ? value.split('__').at(-1) ?? value : value
  const candidate = mcpLeaf.length <= maximum ? mcpLeaf : value
  return maximum === 1 ? '…' : `${candidate.slice(0, maximum - 1)}…`
}

export function renderToolsLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTools || ctx.state.tools.length === 0) {
    return null
  }
  const running = ctx.state.tools.filter(tool => tool.status === 'running').slice(-2)
  const completed = ctx.state.tools.filter(tool => tool.status !== 'running')
  const parts = running.map((tool) => {
    const target = tool.target ? `: ${safeText(tool.target)}` : ''
    return `${color('◐', 'yellow', ctx.options.color)} ${color(safeText(toolName(ctx, tool.name)), 'cyan', ctx.options.color)}${target}`
  })
  const counts = new Map<string, number>()
  for (const tool of completed) {
    counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  }
  const visible = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, ctx.config.display.toolsMaxVisible || undefined)
  for (const [name, count] of visible) {
    parts.push(`${color('✓', 'green', ctx.options.color)} ${safeText(toolName(ctx, name))} ×${count}`)
  }
  return parts.length > 0 ? `${icon('tools')} ${message(ctx.config.language, 'tools')}: ${parts.join(' │ ')}` : null
}

function renderNames(ctx: RenderContext, title: 'skills' | 'mcps', names: string[]): string | null {
  if (names.length === 0) {
    return null
  }
  const visible = names.slice(0, 4).map(name => color(safeText(name), 'cyan', ctx.options.color))
  if (names.length > 4) {
    visible.push(`+${names.length - 4} more`)
  }
  return `${icon(title)} ${color('✓', 'green', ctx.options.color)} ${message(ctx.config.language, title)} (${names.length}): ${visible.join(', ')}`
}

export function renderSkillsLine(ctx: RenderContext): string | null {
  return ctx.config.display.showSkills ? renderNames(ctx, 'skills', ctx.state.skills) : null
}

export function renderMcpLine(ctx: RenderContext): string | null {
  return ctx.config.display.showMcp ? renderNames(ctx, 'mcps', ctx.state.mcpServers) : null
}

export function renderAgentsLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAgents || ctx.state.agents.length === 0) {
    return null
  }
  return ctx.state.agents.slice(-3).map((agent) => {
    const statusIcon = agent.status === 'completed'
      ? color('✓', 'green', ctx.options.color)
      : agent.status === 'error' ? color('✗', 'red', ctx.options.color) : color('◐', 'yellow', ctx.options.color)
    const model = agent.model ? ` [${safeText(agent.model)}]` : ''
    const description = agent.description ? `: ${safeText(agent.description)}` : ''
    const descendants = agent.activeDescendantCount ? ` ↳${agent.activeDescendantCount}` : ''
    return `${icon('agents')} ${statusIcon} ${color(safeText(agent.type), 'magenta', ctx.options.color)}${model}${description} (${elapsed(agent, ctx.now)})${descendants}`
  }).join('\n')
}

export function renderTodosLine(ctx: RenderContext): string | null {
  if (ctx.config.display.showTodos && ctx.state.todos.length > 0) {
    const completed = ctx.state.todos.filter(todo => todo.status === 'completed').length
    const current = ctx.state.todos.find(todo => todo.status === 'in_progress')
    if (current) {
      return `${icon('todos')} ${color('▸', 'yellow', ctx.options.color)} ${safeText(current.content)} (${completed}/${ctx.state.todos.length})`
    }
    if (completed === ctx.state.todos.length) {
      return `${icon('todos')} ${color('✓', 'green', ctx.options.color)} ${message(ctx.config.language, 'allComplete')} (${completed}/${ctx.state.todos.length})`
    }
  }
  if (ctx.config.display.showGoal && ctx.state.goal?.objective) {
    const usage = ctx.state.goal.tokenBudget
      ? ` ${Math.round(((ctx.state.goal.tokensUsed ?? 0) / ctx.state.goal.tokenBudget) * 100)}%`
      : ''
    const prefix = `${color('◆', 'yellow', ctx.options.color)} ${message(ctx.config.language, 'goal')}: `
    const status = ctx.state.goal.status && ctx.state.goal.status !== 'active' ? ` [${ctx.state.goal.status}]` : ''
    const objectiveWidth = Math.max(20, Math.min(Math.floor(ctx.options.width * 0.65), ctx.options.width - 24))
    const objective = truncateAnsi(safeText(ctx.state.goal.objective), objectiveWidth)
    return `${prefix}${objective}${status}${usage}`
  }
  return null
}
