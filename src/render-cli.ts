#!/usr/bin/env node
import type { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
// @env node
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { readConfiguredExternalUsage } from './codex/external-usage.js'
import { readLatestLoggedRateLimits } from './codex/log-rate-limits.js'
import { RolloutParser } from './codex/rollout-parser.js'
import { isOfficialOpenAIEndpoint, resolveProcessEndpoint, resolveProcessSession, resolveSessionEndpoint } from './codex/session-endpoint.js'
import { findActiveSession } from './codex/session-finder.js'
import { loadConfig } from './config/load.js'
import {
  copyImagePath,
  createImagePreview,
  createImageViewerState,
  openImage,
  renderImageViewer,
} from './images/viewer.js'
import {
  createNavigatorState,
  matchingTurnIndices,
  normalizeNavigatorSelection,
  renderNavigator,
  splitNavigatorInput,
} from './navigator/index.js'
import { renderHud } from './render/index.js'
import { watchConfigPath } from './runtime/config-watch.js'
import {
  DEFAULT_HUD_MAX_HEIGHT,
  desiredPaneHeight,
  hudRenderHeight,
  INITIAL_HUD_PANE_HEIGHT,
  readCmuxPaneGeometry,
  resizeCmuxPane,
  resizeHudPane,
  settleCmuxPaneHeight,
} from './runtime/pane-size.js'
import { readSessionBinding, writeSessionBinding } from './runtime/session-binding.js'
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
  cmuxSourcePaneId: string | null
  cmuxWorkspaceId: string | null
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
    cmuxSourcePaneId: null,
    cmuxWorkspaceId: null,
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
    else if (argument === '--cmux-source-pane' && args[index + 1]) {
      options.cmuxSourcePaneId = args[++index]
    }
    else if (argument === '--cmux-workspace' && args[index + 1]) {
      options.cmuxWorkspaceId = args[++index]
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
  const navigator = createNavigatorState()
  const imageViewer = createImageViewerState()
  let currentSessionPath = options.sessionPath
  let lastDiscoveryAt = 0
  let sessionWatcher: fs.FSWatcher | null = null
  let debounceTimer: NodeJS.Timeout | null = null
  let resizeTimer: NodeJS.Timeout | null = null
  parser.setFile(currentSessionPath)
  const startedAt = new Date()
  let lastFrame = ''
  let lastViewport = ''
  let paneHeight: number | null = null
  let cmuxManualHeight = false
  let cmuxResizePending = false
  let cmuxSelfFraction: number | null = null
  let latestTurns = parser.getState().conversationTurns
  let latestImages = parser.getState().images
  let codexPid: number | null = null
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
  let render: () => Promise<void>

  const renderFrame = async (): Promise<void> => {
    const nowMs = Date.now()
    if (currentSessionPath && !fs.existsSync(currentSessionPath)) {
      currentSessionPath = null
      parser.setFile(null)
      sessionWatcher?.close()
      sessionWatcher = null
    }
    if (!options.sessionPath && !currentSessionPath && nowMs - lastDiscoveryAt >= 250) {
      lastDiscoveryAt = nowMs
      const binding = options.sessionBindingPath
        ? readSessionBinding(options.sessionBindingPath)
        : null
      codexPid = binding?.codexPid ?? codexPid
      let bound = binding?.rolloutPath ?? null
      if (!bound && options.sessionBindingPath && codexPid) {
        const processSession = resolveProcessSession(
          codexPid,
          options.cwd,
          options.launchedAfter ?? startedAt,
        )
        if (processSession) {
          bound = processSession.rolloutPath
          writeSessionBinding(options.sessionBindingPath, bound, codexPid)
        }
      }
      const discovered = bound
        ? { path: bound }
        : options.sessionBindingPath
          ? null
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
    const codexProcess = codexPid ? { pid: codexPid, launchedAt: options.launchedAfter ?? startedAt } : null
    const now = new Date()
    const endpoint = rollout.session
      ? resolveSessionEndpoint(rollout.session.id)
      : codexProcess ? resolveProcessEndpoint(codexProcess.pid, codexProcess.launchedAt) : null
    const loggedUsage = (loaded.config.display.showUsage || loaded.config.display.showAuth)
      && isOfficialOpenAIEndpoint(endpoint?.url)
      ? readLatestLoggedRateLimits(process.env, now.getTime(), endpoint?.url ?? null)?.usage ?? null
      : null
    const queriedUsage = loaded.config.display.showAuth
      ? await readConfiguredExternalUsage(loaded.config.display.externalUsageQueries, endpoint?.url ?? null, process.env, now.getTime())
      : null
    const state = buildHudState(
      options.cwd,
      rollout,
      startedAt,
      loaded.config,
      now,
      codexProcess,
      loggedUsage,
      queriedUsage,
      endpoint?.url ?? null,
    )
    latestTurns = state.conversationTurns
    latestImages = state.images
    const width = process.stdout.columns || Number(process.env.COLUMNS) || loaded.config.maxWidth || 120
    const constrainToViewport = options.once
      || Boolean(options.cmuxPaneId && (cmuxManualHeight || cmuxResizePending))
    const height = hudRenderHeight(options.maxHeight, process.stdout.rows, constrainToViewport)
    const lines = imageViewer.active
      ? renderImageViewer(latestImages, imageViewer, {
          width,
          height,
          color: options.color,
          language: loaded.config.language,
        })
      : navigator.active
        ? renderNavigator(latestTurns, navigator, {
            width,
            height,
            color: options.color,
            language: loaded.config.language,
            sessionId: state.session?.id ?? null,
          })
        : renderHud({
            config: loaded.config,
            state,
            options: {
              width,
              height,
              color: options.color,
            },
            now: new Date(),
          })
    const frame = lines.join('\n')
    if (options.once) {
      process.stdout.write(`${frame}\n`)
      return
    }
    const desiredHeight = imageViewer.active || navigator.active
      ? options.maxHeight
      : desiredPaneHeight(lines.length, options.maxHeight)
    if (options.cmuxPaneId) {
      if (!cmuxManualHeight && !cmuxResizePending) {
        const resized = resizeCmuxPane(
          options.cmuxPaneId,
          options.cmuxSourcePaneId,
          options.cmuxWorkspaceId,
          desiredHeight,
          process.stdout.rows,
          paneHeight,
        )
        paneHeight = resized.height
        if (resized.issued) {
          cmuxSelfFraction = resized.fraction
        }
      }
    }
    else {
      paneHeight = resizeHudPane(paneId, desiredHeight, paneHeight)
    }
    const viewport = `${width}x${String(process.stdout.rows ?? '')}`
    const viewportChanged = viewport !== lastViewport
    if (frame !== lastFrame || viewportChanged) {
      lastFrame = frame
      lastViewport = viewport
      const clear = viewportChanged ? '\u001B[2J\u001B[H' : '\u001B[H'
      process.stdout.write(`\u001B[?25l${clear}${lines.map(line => `\u001B[2K${line}`).join('\n')}\u001B[J`)
    }
  }

  let renderPromise: Promise<void> | null = null
  let renderQueued = false
  render = (): Promise<void> => {
    if (renderPromise) {
      renderQueued = true
      return renderPromise
    }
    const run = async (): Promise<void> => {
      do {
        renderQueued = false
        await renderFrame()
      } while (renderQueued)
    }
    renderPromise = run().finally(() => {
      renderPromise = null
    })
    return renderPromise
  }

  await render()
  if (options.once) {
    return
  }
  const interval = setInterval(() => void render(), 1_000)
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
  const onResize = (): void => {
    if (options.cmuxPaneId) {
      cmuxResizePending = true
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      resizeTimer = setTimeout(() => {
        cmuxResizePending = false
        const geometry = readCmuxPaneGeometry(options.cmuxWorkspaceId, options.cmuxPaneId)
        const settled = settleCmuxPaneHeight(process.stdout.rows, paneHeight, cmuxSelfFraction, geometry)
        paneHeight = settled.height
        if (settled.manual) {
          cmuxManualHeight = true
        }
        render()
      }, 150)
    }
    render()
  }
  process.on('SIGWINCH', onResize)
  const focusCodexPane = (): void => {
    if (options.cmuxPaneId) {
      const workspace = process.env.CMUX_WORKSPACE_ID
      spawnSync('cmux', [
        'last-pane',
        ...(workspace ? ['--workspace', workspace] : []),
      ], { stdio: 'ignore' })
      return
    }
    if (paneId) {
      spawnSync('tmux', ['select-pane', '-U'], { stdio: 'ignore' })
    }
  }
  const closeNavigator = (): void => {
    navigator.active = false
    navigator.view = 'list'
    navigator.searchMode = false
    navigator.detailScroll = 0
    render()
    focusCodexPane()
  }
  const closeImageViewer = (): void => {
    imageViewer.active = false
    imageViewer.view = 'list'
    imageViewer.previewScroll = 0
    imageViewer.previewPath = null
    imageViewer.previewLines = []
    render()
    focusCodexPane()
  }
  const selectedImage = () => latestImages[imageViewer.selectedIndex]
  const loadImagePreview = (): void => {
    const image = selectedImage()
    if (!image) {
      imageViewer.previewLines = []
      imageViewer.previewPath = null
      return
    }
    imageViewer.previewPath = image.path
    imageViewer.previewScroll = 0
    imageViewer.previewLines = createImagePreview(image, process.stdout.columns || 120, options.maxHeight)
  }
  const moveImageSelection = (delta: number): void => {
    if (latestImages.length === 0)
      return
    imageViewer.selectedIndex = Math.min(
      latestImages.length - 1,
      Math.max(0, imageViewer.selectedIndex + delta),
    )
  }
  const moveSelection = (delta: number): void => {
    const matches = normalizeNavigatorSelection(navigator, latestTurns)
    if (matches.length === 0) {
      return
    }
    const current = Math.max(0, matches.indexOf(navigator.selectedIndex))
    const next = Math.min(matches.length - 1, Math.max(0, current + delta))
    navigator.selectedIndex = matches[next] ?? navigator.selectedIndex
    navigator.detailScroll = 0
  }
  let shutdown = (): void => {}
  const onKey = (key: string): void => {
    if (key === '\u0003') {
      shutdown()
      return
    }
    if (!navigator.active && !imageViewer.active) {
      if (key === 'i' || key === 'I') {
        if (latestImages.length === 0)
          return
        imageViewer.active = true
        imageViewer.view = 'list'
        imageViewer.selectedIndex = latestImages.length - 1
        render()
        return
      }
      if (
        loaded.config.display.showTurns
        && (key === 'n' || key === 'N' || key === '\r')
        && latestTurns.length > 0
      ) {
        navigator.active = true
        navigator.view = 'list'
        navigator.searchMode = false
        navigator.detailScroll = 0
        navigator.selectedIndex = latestTurns.length - 1
        render()
      }
      return
    }
    if (imageViewer.active) {
      if (key === 'q' || key === 'Q') {
        closeImageViewer()
        return
      }
      if (imageViewer.view === 'preview') {
        if (key === '\u001B' || key === 'h') {
          imageViewer.view = 'list'
          imageViewer.previewScroll = 0
        }
        else if (key === 'o' || key === 'O') {
          const image = selectedImage()
          if (image)
            openImage(image)
        }
        else if (key === 'y' || key === 'Y') {
          const image = selectedImage()
          if (image)
            copyImagePath(image)
        }
        else if (key === 'j' || key === '\u001B[B') {
          imageViewer.previewScroll += 1
        }
        else if (key === 'k' || key === '\u001B[A') {
          imageViewer.previewScroll = Math.max(0, imageViewer.previewScroll - 1)
        }
        else if (key === '\u001B[C') {
          moveImageSelection(1)
          loadImagePreview()
        }
        else if (key === '\u001B[D') {
          moveImageSelection(-1)
          loadImagePreview()
        }
        render()
        return
      }
      if (key === '\u001B') {
        closeImageViewer()
      }
      else if (key === 'j' || key === '\u001B[B') {
        moveImageSelection(1)
      }
      else if (key === 'k' || key === '\u001B[A') {
        moveImageSelection(-1)
      }
      else if (key === 'o' || key === 'O') {
        const image = selectedImage()
        if (image)
          openImage(image)
      }
      else if (key === 'y' || key === 'Y') {
        const image = selectedImage()
        if (image)
          copyImagePath(image)
      }
      else if (key === '\r' || key === 'l' || key === '\u001B[C') {
        if (selectedImage()) {
          imageViewer.view = 'preview'
          loadImagePreview()
        }
      }
      render()
      return
    }
    if (navigator.searchMode) {
      if (key === '\u001B' || key === '\r') {
        navigator.searchMode = false
      }
      else if (key === '\u007F' || key === '\b') {
        navigator.query = Array.from(navigator.query).slice(0, -1).join('')
      }
      else if (!key.startsWith('\u001B') && Array.from(key).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint > 31 && codePoint !== 127
      })) {
        navigator.query += key
      }
      normalizeNavigatorSelection(navigator, latestTurns)
      navigator.detailScroll = 0
      render()
      return
    }
    if (key === 'q' || key === 'Q') {
      closeNavigator()
      return
    }
    if (navigator.view === 'detail') {
      if (key === '\u001B' || key === 'h' || key === '\u001B[D') {
        navigator.view = 'list'
        navigator.detailScroll = 0
      }
      else if (key === 'j' || key === '\u001B[B') {
        navigator.detailScroll += 1
      }
      else if (key === 'k' || key === '\u001B[A') {
        navigator.detailScroll = Math.max(0, navigator.detailScroll - 1)
      }
      else if (key === '\u001B[6~' || key === ' ') {
        navigator.detailScroll += Math.max(1, options.maxHeight - 4)
      }
      else if (key === '\u001B[5~') {
        navigator.detailScroll = Math.max(0, navigator.detailScroll - Math.max(1, options.maxHeight - 4))
      }
      render()
      return
    }
    if (key === '\u001B') {
      closeNavigator()
      return
    }
    if (key === '/') {
      navigator.searchMode = true
    }
    else if (key === 'j' || key === '\u001B[B') {
      moveSelection(1)
    }
    else if (key === 'k' || key === '\u001B[A') {
      moveSelection(-1)
    }
    else if (key === 'g') {
      navigator.selectedIndex = matchingTurnIndices(latestTurns, navigator.query)[0] ?? navigator.selectedIndex
    }
    else if (key === 'G') {
      navigator.selectedIndex = matchingTurnIndices(latestTurns, navigator.query).at(-1) ?? navigator.selectedIndex
    }
    else if (key === '\r' || key === 'l' || key === '\u001B[C') {
      if (latestTurns[navigator.selectedIndex]) {
        navigator.view = 'detail'
        navigator.detailScroll = 0
      }
    }
    render()
  }
  const onInput = (value: Buffer | string): void => {
    splitNavigatorInput(value.toString()).forEach(onKey)
  }
  shutdown = (): void => {
    clearInterval(interval)
    clearInterval(configSafetyInterval)
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }
    sessionWatcher?.close()
    configWatcher?.close()
    process.off('SIGWINCH', onResize)
    process.stdin.off('data', onInput)
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false)
    }
    process.stdout.write('\u001B[?25h\u001B[0m')
    process.exit(0)
  }
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.on('data', onInput)
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
