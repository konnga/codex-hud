import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
// @env node
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { getHudStateDirectory } from '../config/paths.js'
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
  socketPath?: string | null
  sessionPath?: string | null
  allowModifiedSession?: boolean
  env?: NodeJS.ProcessEnv
}

export interface TmuxLaunchResult {
  sessionName: string | null
  hudPaneId: string | null
  socketPath: string | null
  exitCode: number
}

export function createTmuxRunner(
  env: NodeJS.ProcessEnv = process.env,
  socketPath: string | null = null,
): TmuxRunner {
  return {
    run(args, stdio = 'pipe') {
      return spawnSync('tmux', socketPath ? ['-S', socketPath, ...args] : args, {
        encoding: 'utf8',
        env,
        stdio: stdio === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      })
    },
  }
}

export function createPrivateTmuxSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  const directory = path.join(getHudStateDirectory(env), 'tmux')
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  return path.join(directory, `${randomUUID().slice(0, 12)}.sock`)
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
  if (options.allowModifiedSession) {
    args.push('--allow-modified-session')
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
    socketPath: null,
    exitCode: 0,
  }
}

export function launchNewTmuxSession(
  options: TmuxLaunchOptions,
  runner: TmuxRunner = createTmuxRunner(options.env, options.socketPath ?? null),
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
  if (!options.socketPath) {
    const existing = runner.run(['has-session', '-t', sessionName])
    if (existing.status === 0) {
      runner.run(['kill-session', '-t', sessionName])
    }
  }

  const created = runner.run([
    ...(options.socketPath ? ['-f', os.devNull] : []),
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
  runner.run(['set-option', '-t', sessionName, 'prefix', 'None'])
  runner.run(['set-option', '-t', sessionName, 'prefix2', 'None'])
  runner.run(['set-option', '-s', 'focus-events', 'on'])
  runner.run(['set-option', '-s', 'extended-keys', 'on'])
  runner.run(['set-option', '-s', 'set-clipboard', 'external'])
  runner.run(['set-window-option', '-t', `${sessionName}:0`, 'allow-passthrough', 'on'])

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
      socketPath: options.socketPath ?? null,
      exitCode: attached.status ?? 1,
    }
  }

  return {
    sessionName,
    hudPaneId: split.stdout.trim() || null,
    socketPath: options.socketPath ?? null,
    exitCode: 0,
  }
}
