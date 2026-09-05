#!/usr/bin/env node
import type { HudBackendPreference } from './runtime/launcher.js'
import fs from 'node:fs'
import path from 'node:path'
// @env node
import process from 'node:process'
import { resolveUsageData } from './codex/external-usage.js'
import { inspectLoggedRateLimitTargets, readLatestLoggedRateLimits } from './codex/log-rate-limits.js'
import { evaluateUsageTrust, trustedUsageData } from './codex/rate-limits.js'
import { RolloutParser } from './codex/rollout-parser.js'
import { findCodexLogDatabase, inspectCodexLogSchema, resolveSessionEndpoint } from './codex/session-endpoint.js'
import { findActiveSession } from './codex/session-finder.js'
import { hasTrustedOpenAiAuth } from './collectors/session-metadata.js'
import { runConfigure } from './commands/configure.js'
import { inspectManagedInstall, runInstall, runUninstall } from './commands/install.js'
import { runSetup } from './commands/setup.js'
import { loadConfig } from './config/load.js'
import { getCodexHome, getConfigPath } from './config/paths.js'
import { auditCmuxOwnership, cmuxAvailable, createCmuxRunner, isCmuxEnvironment } from './runtime/cmux.js'
import { resolveHubCommand } from './runtime/command.js'
import { readLatestHudLaunchFailure } from './runtime/diagnostics.js'
import { launchCodex, runCodexChild } from './runtime/launcher.js'
import { DEFAULT_HUD_MAX_HEIGHT, INITIAL_HUD_PANE_HEIGHT } from './runtime/pane-size.js'
import { shouldBypassHud } from './runtime/passthrough.js'
import { findExecutable } from './runtime/process.js'
import { HUD_VERSION } from './version.js'

function printHelp(): void {
  console.log(`Codex HUD

Usage:
  codex-hud [start] [HUD options] [--] [codex arguments]
  codex-hud render [--once] [--cwd <path>] [--no-color]
  codex-hud doctor [--json]
  codex-hud setup [--codex-shim] [--preset full|essential|minimal|presentation]
                  [--relay-usage|--no-relay-usage]
                  [--language en|zh-Hans] [--layout compact|expanded] [--yes]
  codex-hud configure [--preset full|essential|minimal|presentation] [--language en|zh-Hans]
  codex-hud configure --status [--json]
  codex-hud configure [--enable <names>] [--disable <names>] --yes
  codex-hud hud-version
  codex-hud install [--codex-shim] [--dry-run]
  codex-hud uninstall [--dry-run]
  codex-hud --help

HUD options:
  --cwd <path>       Working directory for Codex and the HUD
  --hud-height <n>   HUD pane maximum height (default: 30, fits content)
  --detach           Start a background tmux compatibility session
  --backend <name>   Layout backend: auto, cmux, tmux, or none
  --no-hud           Run Codex directly without a HUD backend`)
}

interface InstalledPluginManifest {
  path: string
  version: string | null
  mtimeMs: number
}

function installedPluginManifest(): InstalledPluginManifest | null {
  const root = path.join(getCodexHome(), 'plugins', 'cache')
  try {
    const matches: InstalledPluginManifest[] = []
    const visit = (directory: string, depth: number): void => {
      if (depth > 5)
        return
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          visit(entryPath, depth + 1)
        }
        else if (entry.name === 'plugin.json' && entryPath.includes(`${path.sep}codex-hud${path.sep}`)) {
          let version: string | null = null
          try {
            const manifest = JSON.parse(fs.readFileSync(entryPath, 'utf8')) as { version?: unknown }
            version = typeof manifest.version === 'string' ? manifest.version : null
          }
          catch {
            // A malformed cached manifest is still useful diagnostic evidence.
          }
          matches.push({ path: entryPath, version, mtimeMs: fs.statSync(entryPath).mtimeMs })
        }
      }
    }
    visit(root, 0)
    return matches.sort((left, right) => {
      const byVersion = (left.version ?? '').localeCompare(right.version ?? '', 'en', { numeric: true })
      return byVersion || left.mtimeMs - right.mtimeMs
    }).at(-1) ?? null
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
  backend: HudBackendPreference
  codexArgs: string[]
} {
  let cwd = process.cwd()
  let height = Number(process.env.CODEX_HUD_HEIGHT) || DEFAULT_HUD_MAX_HEIGHT
  let detached = false
  let noHud = false
  let backend: HudBackendPreference = 'auto'
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
      height = Math.max(INITIAL_HUD_PANE_HEIGHT, Math.min(30, Number(args[++index]) || DEFAULT_HUD_MAX_HEIGHT))
    }
    else if (argument === '--detach') {
      detached = true
    }
    else if (argument === '--no-hud') {
      noHud = true
    }
    else if (argument === '--backend' && args[index + 1]) {
      const value = args[++index]
      if (value === 'auto' || value === 'cmux' || value === 'tmux' || value === 'none') {
        backend = value
      }
      else {
        throw new Error(`Invalid HUD backend: ${value}`)
      }
    }
    else {
      codexArgs.push(argument)
    }
  }
  if (shouldBypassHud(args)) {
    noHud = true
  }
  return { cwd, height, detached, noHud, backend, codexArgs }
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
  if (command === 'hud-version') {
    console.log(`codex-hud ${HUD_VERSION}`)
    return
  }
  if (command === 'doctor') {
    const cwdIndex = args.indexOf('--cwd')
    const cwd = cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd()
    const session = findActiveSession({ cwd })
    const config = loadConfig()
    const parser = new RolloutParser({ captureConversationBodies: false })
    parser.setFile(session?.path ?? null)
    const parsed = parser.parse()
    const endpoint = parsed.session ? resolveSessionEndpoint(parsed.session.id) : null
    const usageTrust = evaluateUsageTrust(
      endpoint?.url ?? null,
      hasTrustedOpenAiAuth(parsed.session, process.env),
    )
    const loggedSnapshot = usageTrust.trusted && usageTrust.effectiveEndpoint
      ? readLatestLoggedRateLimits(process.env, Date.now(), usageTrust.effectiveEndpoint)
      : null
    const nativeUsage = trustedUsageData(usageTrust, parsed.usage, loggedSnapshot?.usage ?? null)
    const resolvedUsage = resolveUsageData(nativeUsage, {
      ...config.config.display,
      externalUsageWritePath: '',
    }, new Date())
    const usageSource = nativeUsage
      ? parsed.usage && loggedSnapshot ? 'rollout+log' : parsed.usage ? 'rollout' : 'log'
      : resolvedUsage ? 'external-snapshot' : null
    const usageHiddenReason = !config.config.display.showUsage
      ? 'display-disabled'
      : parsed.usage && !usageTrust.trusted
        ? usageTrust.reason
        : !resolvedUsage ? 'no-fresh-usage-observation' : null
    const pluginManifest = installedPluginManifest()
    const managedInstall = inspectManagedInstall()
    const codex = findExecutable('codex')
    const cmux = findExecutable('cmux')
    const tmux = findExecutable('tmux')
    const cmuxContext = isCmuxEnvironment()
    const cmuxHealthy = Boolean(cmux && cmuxContext && cmuxAvailable(createCmuxRunner(cmux)))
    const cmuxOwnership = auditCmuxOwnership()
    const backend = process.env.TMUX
      ? 'tmux'
      : cmuxContext
        ? cmuxHealthy ? 'cmux' : 'none'
        : tmux ? 'tmux' : 'none'
    const cliPath = path.resolve(process.argv[1])
    const report = {
      hudVersion: HUD_VERSION,
      node: process.version,
      codex,
      cmux,
      cmuxContext,
      cmuxHealthy,
      cmuxOwnership,
      tmux,
      backend,
      cwd,
      configPath: getConfigPath(),
      configValid: config.error === null,
      configError: config.error?.message ?? null,
      activeSession: session?.path ?? null,
      sessionId: session?.sessionId ?? null,
      sessionParsed: parsed.session?.id === session?.sessionId,
      model: parsed.session?.model ?? null,
      codexLogDatabase: findCodexLogDatabase(),
      codexLogSchema: inspectCodexLogSchema(),
      rateLimitLogTargets: inspectLoggedRateLimitTargets(),
      sessionEndpoint: endpoint?.url ?? null,
      sessionEndpointSource: endpoint?.source ?? null,
      usage: {
        visible: Boolean(config.config.display.showUsage && resolvedUsage),
        source: usageSource,
        trust: usageTrust.reason,
        trusted: usageTrust.trusted,
        effectiveEndpoint: usageTrust.effectiveEndpoint,
        rolloutObservedAt: parsed.usageObservedAt?.toISOString() ?? null,
        loggedObservedAt: loggedSnapshot?.observedAt.toISOString() ?? null,
        hiddenReason: usageHiddenReason,
        windows: [resolvedUsage?.primary, resolvedUsage?.secondary, resolvedUsage?.individual]
          .flatMap(window => window
            ? [{
                label: window.label,
                percent: window.percent,
                windowMinutes: window.windowMinutes ?? null,
                resetAt: window.resetAt?.toISOString() ?? null,
              }]
            : []),
      },
      contextCalculation: parsed.context
        ? { source: 'rollout-estimate', baselineTokens: 12_000 }
        : null,
      promptCacheCalculation: {
        source: 'configured-estimate',
        ttlSeconds: config.config.display.promptCacheTtlSeconds,
      },
      pluginManifest: pluginManifest?.path ?? null,
      pluginVersion: pluginManifest?.version ?? null,
      pluginVersionMatchesHud: pluginManifest?.version?.split('+')[0] === HUD_VERSION,
      pluginInstalled: Boolean(pluginManifest),
      managedInstall: managedInstall.present,
      managedInstallDetails: managedInstall,
      terminal: {
        tty: Boolean(process.stdout.isTTY),
        color: !process.env.NO_COLOR,
        columns: process.stdout.columns ?? null,
        rows: process.stdout.rows ?? null,
      },
      shimRecursion: codex === cliPath,
      latestLaunchFailure: readLatestHudLaunchFailure(),
    }
    if (args.includes('--json')) {
      console.log(JSON.stringify(report, null, 2))
    }
    else {
      console.log(`Node: ${report.node}`)
      console.log(`Codex HUD: ${report.hudVersion}`)
      console.log(`Codex: ${report.codex ?? 'not found'}`)
      console.log(`cmux: ${report.cmux ?? 'not found'}${report.cmuxContext ? report.cmuxHealthy ? ' (ready)' : ' (socket unavailable)' : ''}`)
      console.log(`tmux: ${report.tmux ?? 'not found'}`)
      console.log(`Backend: ${report.backend}`)
      console.log(`cmux HUD ownership: ${String(report.cmuxOwnership.total)} total, ${String(report.cmuxOwnership.stale)} stale${report.cmuxOwnership.current ? ' · current surface owned' : ''}`)
      console.log(`Config: ${report.configPath}`)
      console.log(`Session: ${report.activeSession ?? 'not found'}`)
      console.log(`Plugin: ${report.pluginManifest ?? 'not installed'}`)
      console.log(`Session parse: ${report.sessionParsed ? 'ok' : 'not ready'}`)
      console.log(`Session endpoint: ${report.sessionEndpoint ?? 'unknown'}${report.sessionEndpointSource ? ` (${report.sessionEndpointSource})` : ''}`)
      console.log(`Usage: ${report.usage.visible ? report.usage.source ?? 'available' : `hidden (${report.usage.hiddenReason})`} · trust ${report.usage.trust}`)
      console.log(`Managed runtime: ${report.managedInstallDetails.runtimeComplete ? 'complete' : 'incomplete'} · version ${report.managedInstallDetails.hudVersionMatches === null ? 'unavailable' : report.managedInstallDetails.hudVersionMatches ? 'ok' : 'mismatch'} · checksums ${report.managedInstallDetails.checksumsValid === null ? 'unavailable' : report.managedInstallDetails.checksumsValid ? 'ok' : 'mismatch'}`)
      if (report.shimRecursion)
        console.log('Warning: Codex executable resolves to the Codex HUD CLI itself.')
      if (report.latestLaunchFailure) {
        console.log(`Last HUD startup failure: ${report.latestLaunchFailure.backend} · ${report.latestLaunchFailure.error}`)
        console.log(`  ${report.latestLaunchFailure.cwd} · ${report.latestLaunchFailure.timestamp}`)
      }
    }
    return
  }
  if (command === 'configure') {
    process.exitCode = await runConfigure(args.slice(1))
    return
  }
  if (command === 'setup') {
    process.exitCode = await runSetup(args.slice(1))
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
  const launched = await launchCodex(options)
  if (options.detached && launched.sessionName) {
    console.log('Codex HUD started in the background.')
  }
  process.exitCode = launched.exitCode
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
