import type { HudConfig } from '../types/config.js'

export const CURRENT_CONFIG_VERSION = 1

export interface ConfigMigration {
  config: HudConfig
  fromVersion: number
  toVersion: number
  migrated: boolean
}

export function rawConfigVersion(raw: Record<string, unknown>): number {
  const value = raw.configVersion
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export function applyConfigMigrations(
  config: HudConfig,
  raw: Record<string, unknown>,
): ConfigMigration {
  const fromVersion = rawConfigVersion(raw)
  if (fromVersion >= CURRENT_CONFIG_VERSION) {
    return { config, fromVersion, toVersion: fromVersion, migrated: false }
  }

  const migrated = structuredClone(config)
  if (fromVersion < 1) {
    migrated.gitStatus.showFileStats = true
  }
  return {
    config: migrated,
    fromVersion,
    toVersion: CURRENT_CONFIG_VERSION,
    migrated: true,
  }
}
