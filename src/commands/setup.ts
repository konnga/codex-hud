// @env node
import fs from 'node:fs'
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
  return runConfigure(configureArgs(args, hasConfig))
}
