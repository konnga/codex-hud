import type { RenderContext } from '../types/render.js'
import { color } from './colors.js'
import { message } from './i18n.js'

export function renderTurnsLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showTurns || ctx.state.conversationTurns.length === 0) {
    return null
  }
  const count = ctx.state.conversationTurns.length
  const label = color(`↕ ${message(ctx.config.language, 'turns')}`, ctx.config.colors.label, ctx.options.color)
  return `${label}: ${String(count)} · ${message(ctx.config.language, 'navigate')}`
}
