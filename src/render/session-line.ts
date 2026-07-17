import type { RenderContext } from '../types/render.js'
import { formatDuration, formatTokens } from './format.js'
import { message } from './i18n.js'

export function renderSessionLine(ctx: RenderContext): string | null {
  const session = ctx.state.session
  const parts: string[] = []
  if (ctx.config.display.showDuration) {
    parts.push(`⏱️ ${formatDuration(ctx.now.getTime() - ctx.state.sessionStart.getTime())}`)
  }
  if (ctx.config.display.showSessionStartDate && session?.startTime) {
    const locale = ctx.config.language === 'en' ? 'en' : ctx.config.language === 'zh-Hant' ? 'zh-TW' : 'zh-CN'
    parts.push(`${message(ctx.config.language, 'started')} ${session.startTime.toLocaleString(locale)}`)
  }
  if (ctx.config.display.showSpeed && session?.outputTokensPerSecond !== undefined) {
    parts.push(`${message(ctx.config.language, 'output')}: ${session.outputTokensPerSecond.toFixed(1)} tok/s`)
  }
  if (ctx.config.display.showSessionTokens && ctx.state.sessionTokens) {
    const usage = ctx.state.sessionTokens
    parts.push(`${message(ctx.config.language, 'tokens')}: ${formatTokens(usage.totalTokens)} (${message(ctx.config.language, 'input')} ${formatTokens(usage.inputTokens)}, ${message(ctx.config.language, 'cache')} ${formatTokens(usage.cachedInputTokens)}, ${message(ctx.config.language, 'output')} ${formatTokens(usage.outputTokens)})`)
  }
  if (ctx.config.display.showCompactions && ctx.state.compactCount > 0) {
    parts.push(`${message(ctx.config.language, 'compactions')}: ${ctx.state.compactCount}`)
  }
  if (ctx.config.display.showCodexVersion && session?.cliVersion) {
    parts.push(`Codex ${session.cliVersion}`)
  }
  if (ctx.config.display.showSessionId && session?.id) {
    parts.push(`${message(ctx.config.language, 'session')}: ${session.id.slice(0, 8)}`)
  }
  if (ctx.config.display.showLastResponseAt && session?.lastResponseAt) {
    parts.push(`${message(ctx.config.language, 'lastResponse')}: ${formatDuration(ctx.now.getTime() - session.lastResponseAt.getTime())}`)
  }
  return parts.length > 0 ? parts.join(' │ ') : null
}
