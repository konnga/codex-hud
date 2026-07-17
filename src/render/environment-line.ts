import type { RenderContext } from '../types/render.js'
import { formatTokens, progressBar } from './format.js'
import { message } from './i18n.js'

export function renderEnvironmentLine(ctx: RenderContext): string | null {
  const project = ctx.state.project
  const parts: string[] = []
  const totalCounts = project.codexConfigCount + project.agentsMdCount + project.rulesCount
    + project.hooksCount + project.skillsCount + project.mcpCount
  if (ctx.config.display.showConfigCounts && totalCounts >= ctx.config.display.environmentThreshold) {
    if (project.codexConfigCount > 0)
      parts.push(`${project.codexConfigCount} ${message(ctx.config.language, 'configs')}`)
    if (project.agentsMdCount > 0)
      parts.push(`${project.agentsMdCount} AGENTS.md`)
    if (project.rulesCount > 0)
      parts.push(`${project.rulesCount} ${message(ctx.config.language, 'rules')}`)
    if (project.hooksCount > 0)
      parts.push(`${project.hooksCount} ${message(ctx.config.language, 'hooks')}`)
    if (project.skillsCount > 0)
      parts.push(`${project.skillsCount} ${message(ctx.config.language, 'skills')}`)
    if (project.mcpCount > 0)
      parts.push(`${project.mcpCount} MCPs`)
  }
  const session = ctx.state.session
  if (ctx.config.display.showApprovalPolicy && session?.approvalPolicy) {
    parts.push(`${message(ctx.config.language, 'approval')}: ${session.approvalPolicy}`)
  }
  if (ctx.config.display.showPermissionProfile && session?.permissionProfile) {
    parts.push(`${message(ctx.config.language, 'permissions')}: ${session.permissionProfile}`)
  }
  if (ctx.config.display.showSandboxMode && session?.sandboxMode) {
    parts.push(`${message(ctx.config.language, 'sandbox')}: ${session.sandboxMode}`)
  }
  if (ctx.config.display.showCollaborationMode && session?.collaborationMode) {
    parts.push(`${message(ctx.config.language, 'mode')}: ${session.collaborationMode}`)
  }
  return parts.length > 0 ? parts.join(' │ ') : null
}

export function renderMemoryLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showMemoryUsage || !ctx.state.memory) {
    return null
  }
  const memory = ctx.state.memory
  return `${message(ctx.config.language, 'memory')} ${progressBar(memory.usedPercent, 6, ctx.config.colors.barFilled, ctx.config.colors.barEmpty)} ${memory.usedPercent}% (${formatTokens(memory.usedBytes / 1024 / 1024)}MiB)`
}
