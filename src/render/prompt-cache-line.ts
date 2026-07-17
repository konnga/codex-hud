import type { RenderContext } from '../types/render.js'
import { color } from './colors.js'
import { message } from './i18n.js'

export function formatPromptCacheCountdown(remainingMs: number): string {
  if (remainingMs <= 0) {
    return 'expired'
  }
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

export function renderPromptCacheLine(ctx: RenderContext): string | null {
  const responseAt = ctx.state.session?.lastResponseAt
  if (!ctx.config.display.showPromptCache || !responseAt) {
    return null
  }
  const ttlSeconds = ctx.config.display.promptCacheTtlSeconds
  const remainingMs = responseAt.getTime() + ttlSeconds * 1000 - ctx.now.getTime()
  const warningSeconds = Math.min(ttlSeconds, Math.max(60, Math.floor(ttlSeconds / 5)))
  const selectedColor = remainingMs <= 0
    ? ctx.config.colors.label
    : remainingMs <= warningSeconds * 1000 ? ctx.config.colors.warning : ctx.config.colors.context
  return `${message(ctx.config.language, 'promptCache')} ${color(`⏱ ${formatPromptCacheCountdown(remainingMs)}`, selectedColor, ctx.options.color)}`
}
