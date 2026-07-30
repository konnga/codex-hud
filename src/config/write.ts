import type { HudConfig } from '../types/config.js'
// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getConfigPath } from './paths.js'
import { applyConfigMigrations } from './version.js'

function mergeKnownConfig(raw: Record<string, unknown>, config: HudConfig): Record<string, unknown> {
  const migration = applyConfigMigrations(config, raw)
  config = migration.config
  const rawGit = typeof raw.gitStatus === 'object' && raw.gitStatus !== null && !Array.isArray(raw.gitStatus)
    ? raw.gitStatus as Record<string, unknown>
    : {}
  const rawDisplay = typeof raw.display === 'object' && raw.display !== null && !Array.isArray(raw.display)
    ? raw.display as Record<string, unknown>
    : {}
  const rawColors = typeof raw.colors === 'object' && raw.colors !== null && !Array.isArray(raw.colors)
    ? raw.colors as Record<string, unknown>
    : {}

  return {
    ...raw,
    ...config,
    configVersion: migration.toVersion,
    gitStatus: { ...rawGit, ...config.gitStatus },
    display: { ...rawDisplay, ...config.display },
    colors: { ...rawColors, ...config.colors },
  }
}

export function writeConfig(
  config: HudConfig,
  raw: Record<string, unknown> = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configPath = getConfigPath(env)
  const directory = path.dirname(configPath)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporaryPath = path.join(directory, `.${path.basename(configPath)}.${process.pid}.tmp`)
  const serialized = `${JSON.stringify(mergeKnownConfig(raw, config), null, 2)}\n`
  fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporaryPath, configPath)
  return configPath
}
