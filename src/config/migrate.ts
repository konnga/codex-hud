// @env node
import fs from 'node:fs'
import process from 'node:process'
import { loadConfig } from './load.js'
import { applyConfigMigrations, CURRENT_CONFIG_VERSION, rawConfigVersion } from './version.js'
import { writeConfig } from './write.js'

export { CURRENT_CONFIG_VERSION }

export interface ConfigMigrationResult {
  path: string
  fromVersion: number
  toVersion: number
  migrated: boolean
}

export function migrateConfig(options: {
  env?: NodeJS.ProcessEnv
  dryRun?: boolean
} = {}): ConfigMigrationResult {
  const env = options.env ?? process.env
  const loaded = loadConfig(env)
  const fromVersion = rawConfigVersion(loaded.raw)
  if (loaded.error || !fs.existsSync(loaded.path) || fromVersion >= CURRENT_CONFIG_VERSION) {
    return {
      path: loaded.path,
      fromVersion,
      toVersion: Math.max(fromVersion, CURRENT_CONFIG_VERSION),
      migrated: false,
    }
  }

  const migration = applyConfigMigrations(loaded.config, loaded.raw)
  if (!options.dryRun) {
    writeConfig(migration.config, loaded.raw, env)
  }
  return {
    path: loaded.path,
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    migrated: migration.migrated,
  }
}
