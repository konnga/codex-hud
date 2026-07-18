#!/usr/bin/env node
import fs from 'node:fs'
// @env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { RolloutParser } from './codex/rollout-parser.js'
import { findActiveSession } from './codex/session-finder.js'
import { loadConfig } from './config/load.js'
import { renderHud } from './render/index.js'
import { watchConfigPath } from './runtime/config-watch.js'
import {
  DEFAULT_HUD_MAX_HEIGHT,
  desiredPaneHeight,
  INITIAL_HUD_PANE_HEIGHT,
  resizeCmuxPane,
  resizeHudPane,
} from './runtime/pane-size.js'
import { readSessionBinding } from './runtime/session-binding.js'
import { buildHudState } from './runtime/state.js'

interface RenderCliOptions {
  cwd: string
  color: boolean
  once: boolean
  sessionPath: string | null
  sessionBindingPath: string | null
  launchedAfter: Date | null
  allowModifiedSession: boolean
  cmuxPaneId: string | null
  maxHeight: number
}

function parseOptions(args: string[]): RenderCliOptions {
  const options: RenderCliOptions = {
    cwd: process.cwd(),
    color: process.stdout.isTTY && !process.env.NO_COLOR,
    once: false,
    sessionPath: null,
    sessionBindingPath: null,
    launchedAfter: null,
    allowModifiedSession: false,
    cmuxPaneId: null,
    maxHeight: Number(process.env.CODEX_HUD_HEIGHT) || DEFAULT_HUD_MAX_HEIGHT,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--cwd' && args[index + 1]) {
      options.cwd = args[++index]
    }
    else if (argument === '--session' && args[index + 1]) {
      options.sessionPath = args[++index]
    }
    else if (argument === '--once') {
      options.once = true
    }
    else if (argument === '--session-binding' && args[index + 1]) {
      options.sessionBindingPath = args[++index]
    }
    else if (argument === '--launched-after' && args[index + 1]) {
      const value = new Date(args[++index])
      options.launchedAfter = Number.isNaN(value.getTime()) ? null : value
    }
    else if (argument === '--no-color') {
      options.color = false
    }
    else if (argument === '--allow-modified-session') {
      options.allowModifiedSession = true
    }
    else if (argument === '--cmux-pane' && args[index + 1]) {
      options.cmuxPaneId = args[++index]
    }
    else if (argument === '--max-height' && args[index + 1]) {
      options.maxHeight = Math.max(
        INITIAL_HUD_PANE_HEIGHT,
        Math.min(30, Number(args[++index]) || DEFAULT_HUD_MAX_HEIGHT),
      )
    }
  }
  return options
}

export async function runRenderCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args)
  let loaded = loadConfig()
  const parser = new RolloutParser()
  let currentSessionPath = options.sessionPath
  let lastDiscoveryAt = 0
  let sessionWatcher: fs.FSWatcher | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  parser.setFile(currentSessionPath)
  const startedAt = new Date()
  let lastFrame = ''
  let paneHeight: number | null = null
  const paneId = process.env.TMUX_PANE ?? null
  const configMtime = (): number => {
    try {
      return fs.statSync(loaded.path).mtimeMs
    }
    catch {
      return 0
    }
  }
  let lastConfigMtime = configMtime()

  const render = (): void => {
    const nowMs = Date.now()
    if (currentSessionPath && !fs.existsSync(currentSessionPath)) {
      currentSessionPath = null
      parser.setFile(null)
      sessionWatcher?.close()
      sessionWatcher = null
    }
    if (!options.sessionPath && !currentSessionPath && nowMs - lastDiscoveryAt >= 250) {
      lastDiscoveryAt = nowMs
      const bound = options.sessionBindingPath
        ? readSessionBinding(options.sessionBindingPath)
        : null
      const discovered = bound
        ? { path: bound }
        : findActiveSession({
            cwd: options.cwd,
            launchedAfter: options.launchedAfter,
            allowModifiedBeforeLaunch: options.allowModifiedSession,
          })
      if (discovered?.path !== currentSessionPath) {
        currentSessionPath = discovered?.path ?? null
        parser.setFile(currentSessionPath)
        sessionWatcher?.close()
        sessionWatcher = null
        if (currentSessionPath && !options.once) {
          try {
            sessionWatcher = fs.watch(currentSessionPath, () => {
              if (debounceTimer) {
                clearTimeout(debounceTimer)
              }
              debounceTimer = setTimeout(render, 40)
            })
          }
          catch {
            sessionWatcher = null
          }
        }
      }
    }
    const rollout = parser.parse()
    const state = buildHudState(options.cwd, rollout, startedAt, loaded.config, new Date())
    const lines = renderHud({
      config: loaded.config,
      state,
      options: {
        width: process.stdout.columns || Number(process.env.COLUMNS) || loaded.config.maxWidth || 120,
        height: options.maxHeight,
        color: options.color,
      },
      now: new Date(),
    })
    const frame = lines.join('\n')
    if (options.once) {
      process.stdout.write(`${frame}\n`)
      return
    }
    const desiredHeight = desiredPaneHeight(lines.length, options.maxHeight)
    paneHeight = options.cmuxPaneId
      ? resizeCmuxPane(options.cmuxPaneId, desiredHeight, paneHeight)
      : resizeHudPane(paneId, desiredHeight, paneHeight)
    if (frame !== lastFrame) {
      lastFrame = frame
      process.stdout.write(`\u001B[?25l\u001B[H${lines.map(line => `\u001B[2K${line}`).join('\n')}\u001B[J`)
    }
  }

  render()
  if (options.once) {
    return
  }
  const interval = setInterval(render, 1_000)
  const configSafetyInterval = setInterval(() => {
    const nextMtime = configMtime()
    if (nextMtime !== lastConfigMtime) {
      loaded = loadConfig()
      lastConfigMtime = nextMtime
      render()
    }
  }, 10_000)
  const configWatcher = watchConfigPath(loaded.path, () => {
    loaded = loadConfig()
    lastConfigMtime = configMtime()
    render()
  })
  process.on('SIGWINCH', render)
  const shutdown = (): void => {
    clearInterval(interval)
    clearInterval(configSafetyInterval)
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    sessionWatcher?.close()
    configWatcher?.close()
    process.off('SIGWINCH', render)
    process.stdout.write('\u001B[?25h\u001B[0m')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGHUP', shutdown)
}

const entrypoint = process.argv[1]
if (entrypoint && pathToFileURL(entrypoint).href === import.meta.url) {
  runRenderCli().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
