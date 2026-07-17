#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
// @env node
import process from 'node:process'
import { RolloutParser } from './codex/rollout-parser.js'
import { findActiveSession } from './codex/session-finder.js'
import { runConfigure } from './commands/configure.js'
import { runInstall, runUninstall } from './commands/install.js'
import { loadConfig } from './config/load.js'
import { getCodexHome, getConfigPath, getHudStateDirectory } from './config/paths.js'
import { resolveHubCommand } from './runtime/command.js'
import { launchCodex, runCodexChild } from './runtime/launcher.js'
import { shouldBypassHud } from './runtime/passthrough.js'
import { findExecutable } from './runtime/process.js'

function printHelp(): void {
  console.log(`Codex HUD

Usage:
  codex-hud [start] [HUD options] [--] [codex arguments]
  codex-hud render [--once] [--cwd <path>] [--no-color]
  codex-hud doctor [--json]
  codex-hud configure [--preset full|essential|minimal] [--language en|zh-Hans|zh-Hant]
  codex-hud install [--codex-shim] [--dry-run]
  codex-hud uninstall [--dry-run]
  codex-hud --help

HUD options:
  --cwd <path>       Working directory for Codex and the HUD
  --hud-height <n>   HUD pane maximum height (default: 5)
  --detach           Start the tmux session without attaching
  --no-hud           Run Codex directly without tmux`)
}

function installedPluginManifest(): string | null {
  const root = path.join(getCodexHome(), 'plugins', 'cache')
  try {
    const matches: string[] = []
    const visit = (directory: string, depth: number): void => {
      if (depth > 5)
        return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory())
          visit(entryPath, depth + 1)
        else if (entry.name === 'plugin.json' && entryPath.includes(`${path.sep}codex-hud${path.sep}`))
          matches.push(entryPath)
      }
    }
    visit(root, 0)
    return matches.sort().at(-1) ?? null
  }
  catch {
    return null
  }
}

function startOptions(args: string[]): {
  cwd: string
  height: number
  detached: boolean
  noHud: boolean
  codexArgs: string[]
} {
  let cwd = process.cwd()
  let height = Number(process.env.CODEX_HUD_HEIGHT) || 5
  let detached = false
  let noHud = false
  const codexArgs: string[] = []
  let passthrough = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (passthrough) {
      codexArgs.push(argument)
    }
    else if (argument === '--') {
      passthrough = true
    }
    else if ((argument === '--cwd' || argument === '-C') && args[index + 1]) {
      cwd = args[++index]
      codexArgs.push('-C', cwd)
    }
    else if (argument === '--hud-height' && args[index + 1]) {
      height = Math.max(5, Math.min(30, Number(args[++index]) || 5))
    }
    else if (argument === '--detach') {
      detached = true
    }
    else if (argument === '--no-hud') {
      noHud = true
    }
    else {
      codexArgs.push(argument)
    }
  }
  if (shouldBypassHud(args)) {
    noHud = true
  }
  return { cwd, height, detached, noHud, codexArgs }
}

async function main(args = process.argv.slice(2)): Promise<void> {
  const command = resolveHubCommand(args)
  if (command === '__run-codex') {
    const separator = args.indexOf('--')
    const sessionIndex = args.indexOf('--tmux-session')
    const sessionName = sessionIndex >= 0 ? args[sessionIndex + 1] : null
    const waitForClient = args.includes('--wait-for-client')
    const cwdIndex = args.indexOf('--cwd')
    const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd()
    const bindingIndex = args.indexOf('--session-binding')
    const bindingPath = bindingIndex >= 0 ? args[bindingIndex + 1] : null
    const codexArgs = separator >= 0 ? args.slice(separator + 1) : []
    process.exitCode = await runCodexChild(codexArgs, sessionName, waitForClient, cwd, bindingPath)
    return
  }
  if (command === 'render') {
    const { runRenderCli } = await import('./render-cli.js')
    await runRenderCli(args.slice(1))
    return
  }
  if (command === 'doctor') {
    const cwdIndex = args.indexOf('--cwd')
    const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd()
    const session = findActiveSession({ cwd })
    const config = loadConfig()
    const parser = new RolloutParser()
    parser.setFile(session?.path ?? null)
    const parsed = parser.parse()
    const pluginManifest = installedPluginManifest()
    const installState = path.join(getHudStateDirectory(), 'install.json')
    const codex = findExecutable('codex')
    const cliPath = path.resolve(process.argv[1])
    const report = {
      node: process.version,
      codex,
      tmux: findExecutable('tmux'),
      cwd,
      configPath: getConfigPath(),
      configValid: config.error === null,
      configError: config.error?.message ?? null,
      activeSession: session?.path ?? null,
      sessionId: session?.sessionId ?? null,
      sessionParsed: parsed.session?.id === session?.sessionId,
      model: parsed.session?.model ?? null,
      pluginManifest,
      pluginInstalled: Boolean(pluginManifest),
      managedInstall: fs.existsSync(installState),
      terminal: {
        tty: Boolean(process.stdout.isTTY),
        color: !process.env.NO_COLOR,
        columns: process.stdout.columns ?? null,
        rows: process.stdout.rows ?? null,
      },
      shimRecursion: codex === cliPath,
    }
    if (args.includes('--json')) {
      console.log(JSON.stringify(report, null, 2))
    }
    else {
      console.log(`Node: ${report.node}`)
      console.log(`Codex: ${report.codex ?? 'not found'}`)
      console.log(`tmux: ${report.tmux ?? 'not found'}`)
      console.log(`Config: ${report.configPath}`)
      console.log(`Session: ${report.activeSession ?? 'not found'}`)
      console.log(`Plugin: ${report.pluginManifest ?? 'not installed'}`)
      console.log(`Session parse: ${report.sessionParsed ? 'ok' : 'not ready'}`)
      if (report.shimRecursion)
        console.log('Warning: Codex executable resolves to the Hub CLI itself.')
    }
    return
  }
  if (command === 'configure') {
    process.exitCode = await runConfigure(args.slice(1))
    return
  }
  if (command === 'install') {
    process.exitCode = runInstall(args.slice(1))
    return
  }
  if (command === 'uninstall') {
    process.exitCode = runUninstall(args.slice(1))
    return
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  const startArgs = command === 'start' ? args.slice(1) : args
  const options = startOptions(startArgs)
  const launched = launchCodex(options)
  if (options.detached && launched.sessionName) {
    console.log(`Codex HUD started in tmux session ${launched.sessionName}`)
  }
  process.exitCode = launched.exitCode
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
