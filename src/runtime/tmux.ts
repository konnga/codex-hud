import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
// @env node
import { createHash } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { INITIAL_HUD_PANE_HEIGHT } from './pane-size.js'
import { shellCommand } from './process.js'

export interface TmuxRunner {
  run: (args: string[], stdio?: 'inherit' | 'pipe') => SpawnSyncReturns<string>
}

export interface TmuxLaunchOptions {
  cwd: string
  cliPath: string
  renderCliPath: string
  codexArgs: string[]
  height: number
  detached: boolean
  launchedAfter: Date
  bindingPath: string
  sessionPath?: string | null
  env?: NodeJS.ProcessEnv
}

export interface TmuxLaunchResult {
  sessionName: string | null
  hudPaneId: string | null
  exitCode: number
}

export function createTmuxRunner(env: NodeJS.ProcessEnv = process.env): TmuxRunner {
  return {
    run(args, stdio = 'pipe') {
      return spawnSync('tmux', args, {
        encoding: 'utf8',
        env,
        stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      })
    },
  }
}

export function tmuxSessionName(cwd: string, launchIdentity = ''): string {
  const base = path.basename(cwd).replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'project'
  const digest = createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 8)
  const launch = launchIdentity
    ? `-${createHash('sha1').update(launchIdentity).digest('hex').slice(0, 6)}`
    : ''
  return `codex-hud-${base.slice(0, 30)}-${digest}${launch}`
}

function ensureSuccess(result: SpawnSyncReturns<string>, action: string): void {
  if (result.status !== 0) {
    throw new Error(`${action} failed: ${result.stderr || `exit ${String(result.status)}`}`)
  }
}

function renderCommand(options: TmuxLaunchOptions): string {
  const args = [
    '--max-old-space-size=64',
    '--max-semi-space-size=2',
    options.renderCliPath,
    '--cwd',
    options.cwd,
    '--launched-after',
    options.launchedAfter.toISOString(),
    '--session-binding',
    options.bindingPath,
    '--max-height',
    String(options.height),
  ]
  if (options.sessionPath) {
    args.push('--session', options.sessionPath)
  }
  return shellCommand(process.execPath, args)
}

export function launchInsideTmux(
  options: TmuxLaunchOptions,
  runner: TmuxRunner = createTmuxRunner(options.env),
): TmuxLaunchResult {
  const targetPane = options.env?.TMUX_PANE ?? process.env.TMUX_PANE
  const splitArgs = [
    'split-window',
    '-v',
    '-l',
    String(Math.min(INITIAL_HUD_PANE_HEIGHT, options.height)),
    '-d',
    '-P',
    '-F',
    '#{pane_id}',
  ]
  if (targetPane) {
    splitArgs.push('-t', targetPane)
  }
  splitArgs.push(renderCommand(options))
  const split = runner.run(splitArgs)
  ensureSuccess(split, 'tmux split-window')
  return {
    sessionName: null,
    hudPaneId: split.stdout.trim() || null,
    exitCode: 0,
  }
}

export function launchNewTmuxSession(
  options: TmuxLaunchOptions,
  runner: TmuxRunner = createTmuxRunner(options.env),
): TmuxLaunchResult {
  const sessionName = tmuxSessionName(options.cwd, `${options.launchedAfter.toISOString()}:${process.pid}`)
  const internalCommand = shellCommand(process.execPath, [
    options.cliPath,
    '__run-codex',
    '--tmux-session',
    sessionName,
    '--cwd',
    options.cwd,
    '--session-binding',
    options.bindingPath,
    ...(!options.detached ? ['--wait-for-client'] : []),
    '--',
    ...options.codexArgs,
  ])
  const existing = runner.run(['has-session', '-t', sessionName])
  if (existing.status === 0) {
    runner.run(['kill-session', '-t', sessionName])
  }

  const created = runner.run([
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    options.cwd,
    internalCommand,
  ])
  ensureSuccess(created, 'tmux new-session')
  runner.run(['set-option', '-t', sessionName, 'remain-on-exit', 'off'])
  runner.run(['set-option', '-t', sessionName, 'pane-border-status', 'off'])
  runner.run(['set-option', '-t', sessionName, 'status', 'off'])
  runner.run(['set-option', '-t', sessionName, 'mouse', 'on'])

  const split = runner.run([
    'split-window',
    '-t',
    `${sessionName}:0`,
    '-v',
    '-l',
    String(Math.min(INITIAL_HUD_PANE_HEIGHT, options.height)),
    '-d',
    '-c',
    options.cwd,
    '-P',
    '-F',
    '#{pane_id}',
    renderCommand(options),
  ])
  if (split.status !== 0) {
    runner.run(['kill-session', '-t', sessionName])
    ensureSuccess(split, 'tmux split-window')
  }
  runner.run(['select-pane', '-t', `${sessionName}:0.0`])

  if (!options.detached) {
    const attached = runner.run(['attach-session', '-t', sessionName], 'inherit')
    return {
      sessionName,
      hudPaneId: split.stdout.trim() || null,
      exitCode: attached.status ?? 1,
    }
  }

  return {
    sessionName,
    hudPaneId: split.stdout.trim() || null,
    exitCode: 0,
  }
}
