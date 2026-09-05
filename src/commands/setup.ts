import type { Language } from '../types/config.js'
// @env node
import fs from 'node:fs'
import process from 'node:process'
import * as prompts from '@clack/prompts'
import { loadConfig } from '../config/load.js'
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

function setupLanguage(args: string[]): Language {
  const index = args.indexOf('--language')
  const requested = index >= 0 ? args[index + 1] : null
  return requested === 'zh-Hans' || requested === 'en' ? requested : loadConfig().config.language
}

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
  const language = setupLanguage(args)
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
        message: language === 'zh-Hans'
          ? '是否使用当前 API Key 查询第三方 relay 余额？'
          : 'Query third-party relay balances with the active API key?',
        initialValue: false,
      })
      if (prompts.isCancel(enabled)) {
        prompts.cancel(language === 'zh-Hans' ? '已取消设置。' : 'Setup cancelled.')
        return 1
      }
      nextArgs.push(enabled ? '--relay-usage' : '--no-relay-usage')
    }
  }
  const configureExitCode = await runConfigure(nextArgs)
  if (configureExitCode === 0) {
    process.stdout.write(
      language === 'zh-Hans'
        ? '设置完成。当前 Codex 会话无法新增 HUD pane；请先退出，必要时运行 `hash -r`，再启动新的 `codex` 会话。\n'
        : 'Setup complete. The current Codex session cannot gain a HUD pane. '
          + 'Exit it, run `hash -r` if needed, then start a new `codex` session.\n',
    )
  }
  return configureExitCode
}
