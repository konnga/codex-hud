import type { TmuxLaunchResult } from './tmux.js'
// @env node
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { getCodexHome } from '../config/paths.js'
import {
  closeCmuxHud,
  cmuxAvailable,
  createCmuxRunner,
  isCmuxEnvironment,
  launchCmuxHud,
} from './cmux.js'
import { findExecutable } from './process.js'
import {
  acquireSessionDiscoveryLock,
  createSessionBindingPath,
  snapshotRootSessions,
  waitForNewRootSession,
  writeSessionBinding,
} from './session-binding.js'
import {
  createPrivateTmuxSocketPath,
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

function removeFile(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  }
  catch {
    // The parent path may have become unavailable during fallback cleanup.
  }
}

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
  backend?: HudBackendPreference
  env?: NodeJS.ProcessEnv
}

export type HudBackendPreference = 'auto' | 'cmux' | 'tmux' | 'none'
export type HudBackend = Exclude<HudBackendPreference, 'auto'>

export interface LaunchResult extends TmuxLaunchResult {
  backend: HudBackend
  cmuxSurfaceId?: string | null
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

export async function launchCodex(options: LaunchOptions): Promise<LaunchResult> {
  const env = options.env ?? process.env
  const backend = options.backend ?? 'auto'
  const codex = findExecutable('codex', env)
  if (!codex) {
    throw new Error('Codex executable not found. Install @openai/codex or set CODEX_HUD_CODEX_BIN.')
  }
  const runDirect = (): LaunchResult => {
    const result = spawnSync(codex, options.codexArgs, { cwd: options.cwd, env, stdio: 'inherit' })
    return {
      backend: 'none',
      sessionName: null,
      hudPaneId: null,
      socketPath: null,
      exitCode: result.status ?? 1,
    }
  }
  if (options.noHud || backend === 'none') {
    return runDirect()
  }
  const paths = runtimePaths()
  const launchedAfter = new Date()
  const bindingPath = createSessionBindingPath(options.cwd, env)
  const allowModifiedSession = isResumeInvocation(options.codexArgs)

  if (!env.TMUX && !options.detached && (backend === 'auto' || backend === 'cmux') && isCmuxEnvironment(env)) {
    const cmux = findExecutable('cmux', env)
    if (!cmux) {
      process.stderr.write('Codex HUD: cmux is unavailable; starting Codex without the HUD.\n')
      return runDirect()
    }
    const runner = createCmuxRunner(cmux, env)
    if (!cmuxAvailable(runner)) {
      process.stderr.write('Codex HUD: cmux control socket is unavailable; starting Codex without the HUD.\n')
      return runDirect()
    }
    let hud
    try {
      hud = launchCmuxHud({
        cwd: options.cwd,
        renderCliPath: paths.renderCliPath,
        launchedAfter,
        bindingPath,
        maximumHeight: options.height,
        allowModifiedSession,
        env,
      }, runner)
    }
    catch (error) {
      removeFile(bindingPath)
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`Codex HUD: cmux HUD startup failed (${message}); starting Codex without the HUD.\n`)
      return runDirect()
    }
    try {
      const exitCode = await runCodexChild(
        options.codexArgs,
        null,
        false,
        options.cwd,
        bindingPath,
        env,
      )
      return {
        backend: 'cmux',
        sessionName: null,
        hudPaneId: null,
        socketPath: null,
        cmuxSurfaceId: hud.surfaceId,
        exitCode,
      }
    }
    finally {
      closeCmuxHud(hud, runner)
      removeFile(bindingPath)
    }
  }

  if (backend === 'cmux') {
    process.stderr.write('Codex HUD: cmux backend requires an interactive cmux surface; starting Codex without the HUD.\n')
    return runDirect()
  }

  const tmux = findExecutable('tmux', env)
  if (!tmux) {
    process.stderr.write('Codex HUD: tmux is unavailable; starting Codex without the HUD.\n')
    return runDirect()
  }
  let socketPath: string | null = null
  try {
    socketPath = env.TMUX ? null : createPrivateTmuxSocketPath(env)
    const tmuxOptions = {
      cwd: options.cwd,
      cliPath: paths.cliPath,
      renderCliPath: paths.renderCliPath,
      codexArgs: options.codexArgs,
      height: options.height,
      detached: options.detached,
      launchedAfter,
      bindingPath,
      allowModifiedSession,
      socketPath,
      env,
    }
    const runner = createTmuxRunner(env, socketPath)
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
      removeFile(bindingPath)
      return { ...hud, backend: 'tmux', exitCode: result.status ?? 1 }
    }
    const launched = launchNewTmuxSession(tmuxOptions, runner)
    return { ...launched, backend: 'tmux' }
  }
  catch (error) {
    removeFile(bindingPath)
    if (socketPath) {
      removeFile(socketPath)
    }
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
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const codex = findExecutable('codex', env)
  if (!codex) {
    return 127
  }
  if (waitForClient && sessionName && process.env.TMUX) {
    waitForTmuxClient(sessionName)
  }
  const codexHome = getCodexHome(env)
  const release = bindingPath ? await acquireSessionDiscoveryLock(cwd, env) : null
  const snapshot = bindingPath ? snapshotRootSessions(cwd, codexHome) : null
  const allowModifiedSession = isResumeInvocation(args)
  const child = spawn(codex, args, { cwd, stdio: 'inherit', env })
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
        codexHome,
        allowModifiedSession ? 10_000 : 1_000,
        discoveryController.signal,
        allowModifiedSession,
      )
      if (!rolloutPath && childExited) {
        rolloutPath = await waitForNewRootSession(
          cwd,
          snapshot,
          codexHome,
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
  if (bindingPath) {
    fs.rmSync(bindingPath, { force: true })
  }
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
