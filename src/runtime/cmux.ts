import type { SpawnSyncReturns } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
// @env node
import process from 'node:process'
import { getHudStateDirectory } from '../config/paths.js'
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
  sourceSurfaceId: string
  ownershipPath: string
}

interface CmuxHudOwnership {
  version: 1
  workspaceId: string
  sourceSurfaceId: string
  paneId: string
  surfaceId: string
  ownerPid: number
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

export function cmuxHudOwnershipPath(
  workspaceId: string,
  sourceSurfaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const digest = createHash('sha256')
    .update(workspaceId)
    .update('\0')
    .update(sourceSurfaceId)
    .digest('hex')
    .slice(0, 24)
  return path.join(getHudStateDirectory(env), 'cmux', `${digest}.json`)
}

function readOwnership(filePath: string): CmuxHudOwnership | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<CmuxHudOwnership>
    if (
      value.version === 1
      && typeof value.workspaceId === 'string'
      && typeof value.sourceSurfaceId === 'string'
      && typeof value.paneId === 'string'
      && typeof value.surfaceId === 'string'
      && typeof value.ownerPid === 'number'
    ) {
      return value as CmuxHudOwnership
    }
  }
  catch {
    // Missing or malformed ownership is treated as unowned.
  }
  return null
}

function removeOwnership(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  }
  catch {
    // Cleanup remains best-effort when the state directory is unavailable.
  }
}

function replacePreviousOwnership(
  filePath: string,
  workspaceId: string,
  sourceSurfaceId: string,
  runner: CmuxRunner,
): void {
  const previous = readOwnership(filePath)
  if (
    previous
    && previous.workspaceId === workspaceId
    && previous.sourceSurfaceId === sourceSurfaceId
  ) {
    runner.run([
      'close-surface',
      '--workspace',
      previous.workspaceId,
      '--surface',
      previous.surfaceId,
    ])
  }
  removeOwnership(filePath)
}

function writeOwnership(handle: CmuxHudHandle): void {
  fs.mkdirSync(path.dirname(handle.ownershipPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${handle.ownershipPath}.${process.pid}.tmp`
  const ownership: CmuxHudOwnership = {
    version: 1,
    workspaceId: handle.workspaceId,
    sourceSurfaceId: handle.sourceSurfaceId,
    paneId: handle.paneId,
    surfaceId: handle.surfaceId,
    ownerPid: process.pid,
  }
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(ownership, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    fs.renameSync(temporaryPath, handle.ownershipPath)
  }
  finally {
    fs.rmSync(temporaryPath, { force: true })
  }
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
  const ownershipPath = cmuxHudOwnershipPath(workspaceId, sourceSurfaceId, options.env)
  replacePreviousOwnership(ownershipPath, workspaceId, sourceSurfaceId, runner)
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
    sourceSurfaceId,
    ownershipPath,
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
    writeOwnership(handle)
    return handle
  }
  catch (error) {
    closeCmuxHud(handle, runner)
    throw error
  }
}

export function closeCmuxHud(handle: CmuxHudHandle, runner: CmuxRunner): void {
  const closed = runner.run([
    'close-surface',
    '--workspace',
    handle.workspaceId,
    '--surface',
    handle.surfaceId,
  ])
  const ownership = readOwnership(handle.ownershipPath)
  if (closed.status === 0 && ownership?.surfaceId === handle.surfaceId) {
    removeOwnership(handle.ownershipPath)
  }
}
