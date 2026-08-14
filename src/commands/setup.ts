// @env node
import fs from 'node:fs'
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { getConfigPath } from '../config/paths.js'
import { runConfigure } from './configure.js'
import { runInstall } from './install.js'

const OPTIONS_WITH_VALUES = new Set([
  '--disable',
  '--enable',
  '--language',
  '--layout',
  '--preset',
])

function configureArgs(args: string[], hasConfig: boolean): string[] {
  const result: string[] = []
  let hasPreset = false
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--codex-shim' || argument === '--dry-run') {
      continue
    }
    if (argument === '--preset') {
      hasPreset = true
    }
    result.push(argument)
    if (OPTIONS_WITH_VALUES.has(argument) && args[index + 1]) {
      result.push(args[++index])
    }
  }
  if (!hasConfig && !hasPreset) {
    result.unshift('--preset', 'full')
  }
  return result
}

export async function runSetup(args: string[]): Promise<number> {
  const dryRun = args.includes('--dry-run')
  const hasConfig = fs.existsSync(getConfigPath())
  const installArgs = [
    ...(args.includes('--codex-shim') ? ['--codex-shim'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ]
  const installExitCode = runInstall(installArgs)
  if (installExitCode !== 0 || dryRun) {
    return installExitCode
  }
  const nextArgs = configureArgs(args, hasConfig)
  if (!hasConfig && !args.includes('--relay-usage') && !args.includes('--no-relay-usage')) {
    if (args.includes('--yes') || !process.stdin.isTTY) {
      nextArgs.push('--no-relay-usage')
    }
    else {
      const enabled = await prompts.confirm({
        message: 'Query third-party relay balances with the active API key?',
        initialValue: false,
      })
      if (prompts.isCancel(enabled)) {
        prompts.cancel('Setup cancelled.')
        return 1
      }
      nextArgs.push(enabled ? '--relay-usage' : '--no-relay-usage')
    }
  }
  const configureExitCode = await runConfigure(nextArgs)
  if (configureExitCode === 0) {
    process.stdout.write(
      'Setup complete. The current Codex session cannot gain a HUD pane. '
      + 'Exit it, run `hash -r` if needed, then start a new `codex` session.\n',
    )
  }
  return configureExitCode
}
