import type { TmuxLaunchResult } from './tmux.js'
// @env node
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { findExecutable } from './process.js'
import {
  acquireSessionDiscoveryLock,
  createSessionBindingPath,
  snapshotRootSessions,
  waitForNewRootSession,
  writeSessionBinding,
} from './session-binding.js'
import {
  createTmuxRunner,
  launchInsideTmux,
  launchNewTmuxSession,

} from './tmux.js'

const CODEX_OPTIONS_WITH_VALUES = new Set([
  '-C',
  '-c',
  '-m',
  '-p',
  '--ask-for-approval',
  '--cd',
  '--config',
  '--model',
  '--profile',
  '--sandbox',
])

export function isResumeInvocation(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      return false
    }
    if (CODEX_OPTIONS_WITH_VALUES.has(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) {
      return argument === 'resume'
    }
  }
  return false
}

export interface LaunchOptions {
  cwd: string
  codexArgs: string[]
  height: number
  detached: boolean
  noHud: boolean
  env?: NodeJS.ProcessEnv
}

export function runtimePaths(): { cliPath: string, renderCliPath: string } {
  const modulePath = fileURLToPath(import.meta.url)
  const cliPath = modulePath.endsWith('.ts')
    ? path.resolve('dist/cli.mjs')
    : path.join(path.dirname(modulePath), 'cli.mjs')
  return {
    cliPath,
    renderCliPath: path.join(path.dirname(cliPath), 'render-cli.mjs'),
  }
}

export function launchCodex(options: LaunchOptions): TmuxLaunchResult {
  const env = options.env ?? process.env
  const codex = findExecutable('codex', env)
  if (!codex) {
    throw new Error('Codex executable not found. Install @openai/codex or set CODEX_HUD_CODEX_BIN.')
  }
  const runDirect = (): TmuxLaunchResult => {
    const result = spawnSync(codex, options.codexArgs, { cwd: options.cwd, env, stdio: 'inherit' })
    return { sessionName: null, hudPaneId: null, exitCode: result.status ?? 1 }
  }
  if (options.noHud) {
    return runDirect()
  }
  const tmux = findExecutable('tmux', env)
  if (!tmux) {
    process.stderr.write('Codex HUD: tmux is unavailable; starting Codex without the HUD.\n')
    return runDirect()
  }
  const paths = runtimePaths()
  const launchedAfter = new Date()
  const bindingPath = createSessionBindingPath(options.cwd)
  const tmuxOptions = {
    cwd: options.cwd,
    cliPath: paths.cliPath,
    renderCliPath: paths.renderCliPath,
    codexArgs: options.codexArgs,
    height: options.height,
    detached: options.detached,
    launchedAfter,
    bindingPath,
    env,
  }
  const runner = createTmuxRunner(env)
  try {
    if (env.TMUX) {
      const hud = launchInsideTmux(tmuxOptions, runner)
      const result = spawnSync(process.execPath, [
        paths.cliPath,
        '__run-codex',
        '--cwd',
        options.cwd,
        '--session-binding',
        bindingPath,
        '--',
        ...options.codexArgs,
      ], { cwd: options.cwd, env, stdio: 'inherit' })
      if (hud.hudPaneId) {
        runner.run(['kill-pane', '-t', hud.hudPaneId])
      }
      return { ...hud, exitCode: result.status ?? 1 }
    }
    return launchNewTmuxSession(tmuxOptions, runner)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Codex HUD: HUD startup failed (${message}); starting Codex directly.\n`)
    return runDirect()
  }
}

export async function runCodexChild(
  args: string[],
  sessionName: string | null,
  waitForClient = false,
  cwd = process.cwd(),
  bindingPath: string | null = null,
): Promise<number> {
  const codex = findExecutable('codex')
  if (!codex) {
    return 127
  }
  if (waitForClient && sessionName && process.env.TMUX) {
    waitForTmuxClient(sessionName)
  }
  const release = bindingPath ? await acquireSessionDiscoveryLock(cwd) : null
  const snapshot = bindingPath ? snapshotRootSessions(cwd) : null
  const allowModifiedSession = isResumeInvocation(args)
  const child = spawn(codex, args, { cwd, stdio: 'inherit', env: process.env })
  const discoveryController = new AbortController()
  let childExited = false
  const exitCodePromise = new Promise<number>((resolve) => {
    const finish = (code: number): void => {
      childExited = true
      discoveryController.abort()
      resolve(code)
    }
    child.once('error', () => finish(1))
    child.once('exit', code => finish(code ?? 1))
  })
  if (bindingPath && snapshot && release) {
    try {
      let rolloutPath = await waitForNewRootSession(
        cwd,
        snapshot,
        undefined,
        undefined,
        discoveryController.signal,
        allowModifiedSession,
      )
      if (!rolloutPath && childExited) {
        rolloutPath = await waitForNewRootSession(
          cwd,
          snapshot,
          undefined,
          250,
          undefined,
          allowModifiedSession,
        )
      }
      if (rolloutPath) {
        writeSessionBinding(bindingPath, rolloutPath)
      }
    }
    finally {
      release()
    }
  }
  const exitCode = await exitCodePromise
  if (sessionName && process.env.TMUX) {
    const cleanup = spawn('tmux', ['kill-session', '-t', sessionName], {
      detached: true,
      stdio: 'ignore',
    })
    cleanup.unref()
  }
  return exitCode
}

type TmuxClientProbe = (sessionName: string) => number

function defaultClientProbe(sessionName: string): number {
  const result = spawnSync('tmux', ['display-message', '-p', '-t', sessionName, '#{session_attached}'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? Number.parseInt(result.stdout.trim(), 10) || 0 : 0
}

export function waitForTmuxClient(
  sessionName: string,
  timeoutMs = 30_000,
  probe: TmuxClientProbe = defaultClientProbe,
  pause: (milliseconds: number) => void = (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
  },
): boolean {
  const deadline = Date.now() + timeoutMs
  do {
    if (probe(sessionName) > 0) {
      return true
    }
    pause(50)
  } while (Date.now() < deadline)
  return false
}
