import type { HudConfig } from '../types/config.js'
// @env node
import fs from 'node:fs'
import process from 'node:process'
import { getConfigPath } from './paths.js'
import { validateConfig } from './validate.js'
import { applyConfigMigrations } from './version.js'

export interface LoadedConfig {
  config: HudConfig
  path: string
  raw: Record<string, unknown>
  error: Error | null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const configPath = getConfigPath(env)
  try {
    const source = fs.readFileSync(configPath, 'utf8')
    const parsed: unknown = JSON.parse(source)
    const raw = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
    const migration = applyConfigMigrations(validateConfig(raw), raw)
    return {
      config: migration.config,
      path: configPath,
      raw,
      error: null,
    }
  }
  catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT'
    return {
      config: validateConfig({}),
      path: configPath,
      raw: {},
      error: missing ? null : error as Error,
    }
  }
}

export function reloadConfig(previous: LoadedConfig, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const next = loadConfig(env)
  return next.error
    ? { ...previous, error: next.error }
    : next
}
