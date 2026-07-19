import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
// @env node
import process from 'node:process'
import { shellCommand } from './process.js'

export interface CmuxRunner {
  run: (args: string[]) => SpawnSyncReturns<string>
}

export interface CmuxHudOptions {
  cwd: string
  renderCliPath: string
  launchedAfter: Date
  bindingPath: string
  maximumHeight: number
  allowModifiedSession: boolean
  env?: NodeJS.ProcessEnv
}

export interface CmuxHudHandle {
  workspaceId: string
  paneId: string
  surfaceId: string
}

interface CmuxCreationPayload {
  pane_id?: unknown
  surface_id?: unknown
  workspace_id?: unknown
}

interface CmuxIdentityPayload {
  caller?: {
    pane_id?: unknown
  }
}

export function isCmuxEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CMUX_WORKSPACE_ID && env.CMUX_SURFACE_ID)
}

export function createCmuxRunner(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): CmuxRunner {
  return {
    run(args) {
      return spawnSync(executable, args, {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 1_500,
      })
    },
  }
}

export function cmuxAvailable(runner: CmuxRunner): boolean {
  return runner.run(['ping']).status === 0
}

function ensureSuccess(result: SpawnSyncReturns<string>, action: string): void {
  if (result.status !== 0) {
    throw new Error(`${action} failed: ${result.stderr || `exit ${String(result.status)}`}`)
  }
}

function creationPayload(result: SpawnSyncReturns<string>): CmuxCreationPayload {
  try {
    return JSON.parse(result.stdout) as CmuxCreationPayload
  }
  catch {
    throw new Error('cmux split returned invalid JSON')
  }
}

function requiredId(payload: CmuxCreationPayload, key: keyof CmuxCreationPayload): string {
  const value = payload[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`cmux split did not return ${key}`)
  }
  return value
}

function rendererCommand(
  options: CmuxHudOptions,
  paneId: string,
  sourcePaneId: string,
  workspaceId: string,
): string {
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
    String(options.maximumHeight),
    '--cmux-pane',
    paneId,
    '--cmux-source-pane',
    sourcePaneId,
    '--cmux-workspace',
    workspaceId,
  ]
  if (options.allowModifiedSession) {
    args.push('--allow-modified-session')
  }
  return `exec ${shellCommand(process.execPath, args)}\n`
}

export function launchCmuxHud(
  options: CmuxHudOptions,
  runner: CmuxRunner,
): CmuxHudHandle {
  const workspaceId = options.env?.CMUX_WORKSPACE_ID ?? process.env.CMUX_WORKSPACE_ID
  const sourceSurfaceId = options.env?.CMUX_SURFACE_ID ?? process.env.CMUX_SURFACE_ID
  if (!workspaceId || !sourceSurfaceId) {
    throw new Error('cmux workspace or surface context is unavailable')
  }
  const identified = runner.run([
    '--json',
    '--id-format',
    'uuids',
    'identify',
    '--workspace',
    workspaceId,
    '--surface',
    sourceSurfaceId,
  ])
  ensureSuccess(identified, 'cmux identify')
  let identity: CmuxIdentityPayload
  try {
    identity = JSON.parse(identified.stdout) as CmuxIdentityPayload
  }
  catch {
    throw new Error('cmux identify returned invalid JSON')
  }
  const sourcePaneId = identity.caller?.pane_id
  if (typeof sourcePaneId !== 'string' || !sourcePaneId) {
    throw new Error('cmux identify did not return caller.pane_id')
  }
  const split = runner.run([
    '--json',
    '--id-format',
    'uuids',
    'new-split',
    'down',
    '--workspace',
    workspaceId,
    '--surface',
    sourceSurfaceId,
    '--focus',
    'false',
  ])
  ensureSuccess(split, 'cmux new-split')
  const payload = creationPayload(split)
  const handle: CmuxHudHandle = {
    workspaceId: typeof payload.workspace_id === 'string' && payload.workspace_id
      ? payload.workspace_id
      : workspaceId,
    paneId: requiredId(payload, 'pane_id'),
    surfaceId: requiredId(payload, 'surface_id'),
  }
  try {
    const resize = runner.run([
      'resize-pane',
      '--workspace',
      handle.workspaceId,
      '--pane',
      sourcePaneId,
      '-D',
      '--amount',
      '10000',
    ])
    ensureSuccess(resize, 'cmux resize-pane')
    const send = runner.run([
      'send',
      '--workspace',
      handle.workspaceId,
      '--surface',
      handle.surfaceId,
      '--',
      rendererCommand(options, handle.paneId, sourcePaneId, handle.workspaceId),
    ])
    ensureSuccess(send, 'cmux send')
    return handle
  }
  catch (error) {
    closeCmuxHud(handle, runner)
    throw error
  }
}

export function closeCmuxHud(handle: CmuxHudHandle, runner: CmuxRunner): void {
  runner.run([
    'close-surface',
    '--workspace',
    handle.workspaceId,
    '--surface',
    handle.surfaceId,
  ])
}
