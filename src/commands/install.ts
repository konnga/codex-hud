// @env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { getHudStateDirectory, getLegacyStateDirectory } from '../config/paths.js'
import { findExecutable, shellQuote } from '../runtime/process.js'

interface InstallState {
  version: 1
  realCodex: string
  managedFiles: string[]
  runtimeDirectory?: string
}

const MANAGED_MARKER = '# Managed by Codex HUD'
const LEGACY_MANAGED_MARKER = '# Managed by Codex Hub'

function output(message: string): void {
  process.stdout.write(`${message}\n`)
}

function statePath(): string {
  return path.join(getHudStateDirectory(), 'install.json')
}

function readInstallState(): InstallState | null {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8')) as InstallState
    return state.version === 1 && Array.isArray(state.managedFiles) ? state : null
  }
  catch {
    return null
  }
}

function isManagedLauncher(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return [MANAGED_MARKER, LEGACY_MANAGED_MARKER]
      .some(marker => content.startsWith(`#!/bin/sh\n${marker}\n`))
  }
  catch {
    return false
  }
}

function binDirectory(): string {
  const explicit = process.env.CODEX_HUD_BIN_DIR || process.env.CODEX_HUB_BIN_DIR
  return explicit
    ? path.resolve(explicit)
    : path.join(os.homedir(), '.local', 'bin')
}

function migrateLegacyState(dryRun: boolean): void {
  const legacy = getLegacyStateDirectory()
  const canonical = getHudStateDirectory()
  if (legacy === canonical || !fs.existsSync(legacy) || fs.existsSync(canonical)) {
    return
  }
  if (dryRun) {
    output(`Would migrate ${legacy} -> ${canonical}`)
    return
  }
  fs.cpSync(legacy, canonical, { recursive: true, preserveTimestamps: true })
}

function runtimeSourceDirectory(): string {
  return path.resolve(process.env.CODEX_HUD_RUNTIME_DIR || path.dirname(process.argv[1]))
}

function managedRuntimeDirectory(): string {
  return path.join(getHudStateDirectory(), 'runtime')
}

function installedRuntimeDirectory(state: InstallState): string {
  const expected = managedRuntimeDirectory()
  return state.runtimeDirectory && path.resolve(state.runtimeDirectory) === path.resolve(expected)
    ? state.runtimeDirectory
    : expected
}

function executablePaths(directory: string): { cli: string, render: string } {
  return {
    cli: path.join(directory, 'cli.mjs'),
    render: path.join(directory, 'render-cli.mjs'),
  }
}

function validateRuntime(directory: string): void {
  const paths = executablePaths(directory)
  if (!fs.existsSync(paths.cli) || !fs.existsSync(paths.render)) {
    throw new Error(`Codex HUD runtime is incomplete: ${directory}`)
  }
}

function sameDirectory(left: string, right: string): boolean {
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right)
  }
  catch {
    return path.resolve(left) === path.resolve(right)
  }
}

function deployRuntime(source: string, target: string, dryRun: boolean): void {
  validateRuntime(source)
  if (sameDirectory(source, target)) {
    return
  }
  if (dryRun) {
    output(`Would install runtime ${source} -> ${target}`)
    return
  }
  const suffix = `${process.pid}-${Date.now()}`
  const staging = `${target}.install-${suffix}`
  const backup = `${target}.backup-${suffix}`
  let movedPrevious = false
  fs.rmSync(staging, { recursive: true, force: true })
  fs.rmSync(backup, { recursive: true, force: true })
  try {
    fs.cpSync(source, staging, { recursive: true, preserveTimestamps: true })
    validateRuntime(staging)
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup)
      movedPrevious = true
    }
    fs.renameSync(staging, target)
    fs.rmSync(backup, { recursive: true, force: true })
  }
  catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    if (movedPrevious) {
      fs.rmSync(target, { recursive: true, force: true })
      fs.renameSync(backup, target)
    }
    throw error
  }
}

function ensureManagedTarget(target: string, dryRun: boolean): void {
  if (!fs.existsSync(target)) {
    return
  }
  let managed = false
  const state = readInstallState()
  managed = Boolean(state?.managedFiles.includes(target) && isManagedLauncher(target))
  if (!managed && !dryRun) {
    throw new Error(`Refusing to overwrite unmanaged file: ${target}`)
  }
}

function writeLauncher(
  target: string,
  source: string,
  dryRun: boolean,
  realCodex?: string,
): void {
  ensureManagedTarget(target, dryRun)
  if (dryRun) {
    output(`Would install ${target} -> ${source}`)
    return
  }
  const realCodexExport = realCodex
    ? `export CODEX_HUD_CODEX_BIN=${shellQuote(realCodex)}\n`
    : ''
  const content = `#!/bin/sh\n${MANAGED_MARKER}\n${realCodexExport}exec /usr/bin/env node ${shellQuote(source)} "$@"\n`
  fs.writeFileSync(target, content, { encoding: 'utf8', mode: 0o755 })
}

export function runInstall(args: string[]): number {
  const dryRun = args.includes('--dry-run')
  const installCodexShim = args.includes('--codex-shim')
  migrateLegacyState(dryRun)
  const directory = binDirectory()
  const runtimeSource = runtimeSourceDirectory()
  const runtimeDirectory = managedRuntimeDirectory()
  const paths = executablePaths(runtimeDirectory)
  const realCodex = findExecutable('codex', process.env, [
    path.join(directory, 'codex'),
  ])
  if (!realCodex) {
    throw new Error('Unable to find the real Codex executable before installing the shim.')
  }
  const managedFiles = [
    path.join(directory, 'codex-hud'),
    path.join(directory, 'codex-hud-render'),
  ]
  if (installCodexShim) {
    managedFiles.push(path.join(directory, 'codex'))
  }
  const legacyManagedFiles = [path.join(directory, 'codex-hub'), path.join(directory, 'codex-hub-render')]
  if (!dryRun) {
    fs.mkdirSync(directory, { recursive: true })
    fs.mkdirSync(getHudStateDirectory(), { recursive: true, mode: 0o700 })
  }
  const previousState = readInstallState()
  for (const target of managedFiles) {
    ensureManagedTarget(target, dryRun)
  }
  deployRuntime(runtimeSource, runtimeDirectory, dryRun)
  writeLauncher(managedFiles[0], paths.cli, dryRun, realCodex)
  writeLauncher(managedFiles[1], paths.render, dryRun)
  if (installCodexShim) {
    const target = managedFiles[2]
    ensureManagedTarget(target, dryRun)
    if (dryRun) {
      output(`Would install Codex shim ${target}`)
    }
    else {
      const content = `#!/bin/sh\n${MANAGED_MARKER}\nexport CODEX_HUD_CODEX_BIN=${shellQuote(realCodex)}\nexec /usr/bin/env node ${shellQuote(paths.cli)} "$@"\n`
      fs.writeFileSync(target, content, { encoding: 'utf8', mode: 0o755 })
    }
  }
  if (!dryRun) {
    for (const obsolete of previousState?.managedFiles ?? []) {
      if (!managedFiles.includes(obsolete) && isManagedLauncher(obsolete)) {
        fs.rmSync(obsolete, { force: true })
      }
    }
    for (const obsolete of legacyManagedFiles) {
      if (isManagedLauncher(obsolete)) {
        fs.rmSync(obsolete, { force: true })
      }
    }
    const state: InstallState = { version: 1, realCodex, managedFiles, runtimeDirectory }
    fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    output(`Installed Codex HUD commands in ${directory}`)
  }
  return 0
}

export function runUninstall(args: string[]): number {
  const dryRun = args.includes('--dry-run')
  let state: InstallState
  try {
    const loaded = readInstallState()
    if (!loaded) {
      throw new Error('Missing or invalid install state')
    }
    state = loaded
  }
  catch {
    output('Codex HUD has no managed installation state.')
    return 0
  }
  for (const filePath of state.managedFiles) {
    if (dryRun) {
      output(`Would remove ${filePath}`)
    }
    else if (isManagedLauncher(filePath)) {
      fs.rmSync(filePath, { force: true })
    }
    else {
      output(`Skipped modified or unmanaged file: ${filePath}`)
    }
  }
  const runtimeDirectory = installedRuntimeDirectory(state)
  if (dryRun) {
    output(`Would remove ${runtimeDirectory}`)
  }
  else {
    fs.rmSync(runtimeDirectory, { recursive: true, force: true })
  }
  if (!dryRun) {
    fs.rmSync(statePath(), { force: true })
    output('Removed Codex HUD managed launchers.')
  }
  return 0
}
