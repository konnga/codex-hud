import type { HudElement } from '../types/config.js'

export const CONFIG_DIRECTORY_NAME = 'codex-hud'
export const LEGACY_CONFIG_DIRECTORY_NAME = 'codex-hub'
export const CONFIG_FILE_NAME = 'config.json'
export const KNOWN_ELEMENTS = new Set<HudElement>([
  'project',
  'addedDirs',
  'context',
  'usage',
  'promptCache',
  'memory',
  'environment',
  'tools',
  'skills',
  'mcp',
  'agents',
  'todos',
  'sessionTime',
])

export const MIN_REFRESH_INTERVAL_MS = 100
export const MAX_REFRESH_INTERVAL_MS = 60_000
export const MIN_PROMPT_CACHE_TTL_SECONDS = 1
export const MAX_PROMPT_CACHE_TTL_SECONDS = 86_400
