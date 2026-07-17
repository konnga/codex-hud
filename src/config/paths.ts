// @env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME, LEGACY_CONFIG_DIRECTORY_NAME } from './constants.js'

export function getCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'))
}

export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CODEX_HUD_CONFIG || env.CODEX_HUB_CONFIG
  if (explicit) {
    return path.resolve(explicit)
  }
  const canonical = path.join(getCodexHome(env), CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME)
  const legacy = path.join(getCodexHome(env), LEGACY_CONFIG_DIRECTORY_NAME, CONFIG_FILE_NAME)
  return !fs.existsSync(canonical) && fs.existsSync(legacy) ? legacy : canonical
}

export function getHudStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getCodexHome(env), CONFIG_DIRECTORY_NAME)
}

export function getLegacyStateDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getCodexHome(env), LEGACY_CONFIG_DIRECTORY_NAME)
}
