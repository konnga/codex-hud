import type { RenderContext } from '../types/render.js'
import { color } from './colors.js'
import { projectPath, safeText, visibleWidth } from './format.js'
import { message } from './i18n.js'

function addedDirectories(ctx: RenderContext, prefix: boolean): string[] {
  const projectRoot = ctx.state.project.projectRoot.replace(/[\\/]+$/, '')
  const roots = ctx.state.project.workspaceRoots
    .filter(root => root.replace(/[\\/]+$/, '') !== projectRoot)
    .slice(0, 5)
    .map((root) => {
      const name = projectPath(root, 1)
      const shortened = name.length > 24 ? `${name.slice(0, 23)}…` : name
      return prefix ? `+${shortened}` : shortened
    })
  const extra = ctx.state.project.workspaceRoots.filter(root => root.replace(/[\\/]+$/, '') !== projectRoot).length - roots.length
  if (extra > 0) {
    roots.push(prefix ? `+${extra} more` : `+${extra} more`)
  }
  return roots
}

function modelName(ctx: RenderContext): string | null {
  const override = ctx.config.display.modelOverride.trim()
  const model = override || ctx.state.session?.model
  if (!model || !ctx.config.display.showModel) {
    return null
  }
  const compact = ctx.config.display.modelFormat === 'full'
    ? model
    : model.replace(/^openai\//, '').replace(/-\d+k(?:-context)?$/i, '')
  const effort = ctx.config.display.showEffortLevel && ctx.state.session?.reasoningEffort
    ? ` ${ctx.state.session.reasoningEffort}`
    : ''
  const provider = ctx.config.display.showProvider
    ? ctx.config.display.providerName || ctx.state.session?.modelProvider
    : null
  const text = provider ? `${provider} | ${compact}${effort}` : `${compact}${effort}`
  return color(`[${safeText(text)}]`, ctx.config.colors.model, ctx.options.color)
}

function gitSegment(ctx: RenderContext): string | null {
  if (!ctx.config.gitStatus.enabled || !ctx.state.git?.isGitRepo || !ctx.state.git.branch) {
    return null
  }
  const status = ctx.state.git
  const dirty = ctx.config.gitStatus.showDirty && status.isDirty ? '*' : ''
  const wrapper = color('git:(', ctx.config.colors.git, ctx.options.color)
  let branch = color(`${safeText(status.branch ?? '')}${dirty}`, ctx.config.colors.gitBranch, ctx.options.color)
  if (ctx.config.gitStatus.showAheadBehind && status.ahead > 0) {
    const aheadColor = ctx.config.gitStatus.pushCriticalThreshold > 0 && status.ahead >= ctx.config.gitStatus.pushCriticalThreshold
      ? ctx.config.colors.critical
      : ctx.config.gitStatus.pushWarningThreshold > 0 && status.ahead >= ctx.config.gitStatus.pushWarningThreshold
        ? ctx.config.colors.warning
        : ctx.config.colors.gitBranch
    branch += color(` ↑${status.ahead}`, aheadColor, ctx.options.color)
  }
  if (ctx.config.gitStatus.showAheadBehind && status.behind > 0) {
    branch += color(` ↓${status.behind}`, ctx.config.colors.gitBranch, ctx.options.color)
  }
  const statParts = [
    status.modified > 0 ? `!${status.modified}` : null,
    status.added > 0 ? `+${status.added}` : null,
    status.deleted > 0 ? `✘${status.deleted}` : null,
    status.untracked > 0 ? `?${status.untracked}` : null,
  ].filter((value): value is string => Boolean(value))
  const stats = ctx.config.gitStatus.showFileStats && statParts.length > 0 ? ` ${statParts.join(' ')}` : ''
  return `${wrapper}${branch}${color(')', ctx.config.colors.git, ctx.options.color)}${stats}`
}

function authSegment(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAuth || !ctx.state.auth) {
    return null
  }
  const maximum = ctx.config.display.authUserLength
  const rawUser = ctx.state.auth.user ?? ''
  const user = maximum > 0 && rawUser.length > maximum
    ? `${rawUser.slice(0, Math.max(1, maximum - 1))}…`
    : rawUser
  return ctx.config.display.showAuthUser && user
    ? `${ctx.state.auth.method} (${user})`
    : ctx.state.auth.method
}

export function renderProjectLine(ctx: RenderContext): string | null {
  const parts: string[] = []
  const model = modelName(ctx)
  if (model) {
    parts.push(model)
  }
  if (ctx.config.display.showProject) {
    let project = color(
      projectPath(ctx.state.project.projectRoot, ctx.config.pathLevels),
      ctx.config.colors.project,
      ctx.options.color,
    )
    if (ctx.config.display.showAddedDirs && ctx.config.display.addedDirsLayout === 'inline') {
      const added = addedDirectories(ctx, true)
      if (added.length > 0) {
        project = `${project} ${added.join(' ')}`
      }
    }
    parts.push(project)
  }
  const git = gitSegment(ctx)
  if (git) {
    parts.push(git)
  }
  if (ctx.config.display.showSessionName && ctx.state.session?.sessionName) {
    parts.push(safeText(ctx.state.session.sessionName))
  }
  const auth = authSegment(ctx)
  if (auth) {
    parts.push(safeText(auth))
  }
  const line = parts.length > 0 ? parts.join(' │ ') : null
  if (line && git && ctx.config.gitStatus.branchOverflow === 'wrap' && visibleWidth(line) > ctx.options.width) {
    return `${parts.filter(part => part !== git).join(' │ ')}\n${git}`
  }
  return line
}

export function renderAddedDirsLine(ctx: RenderContext): string | null {
  if (!ctx.config.display.showAddedDirs || ctx.config.display.addedDirsLayout !== 'line') {
    return null
  }
  const roots = addedDirectories(ctx, false)
  return roots.length > 0 ? `${message(ctx.config.language, 'addedDirs')}: ${roots.join(', ')}` : null
}
