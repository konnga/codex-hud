// @env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  excludedPaths: string[] = [],
): string | null {
  const explicit = name === 'codex' ? env.CODEX_HUD_CODEX_BIN || env.CODEX_HUB_CODEX_BIN : undefined
  const candidates = explicit
    ? [explicit]
    : (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, name))
  const excluded = new Set(excludedPaths.map(value => path.resolve(value)))
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (excluded.has(resolved)) {
      continue
    }
    try {
      fs.accessSync(resolved, fs.constants.X_OK)
      if (fs.statSync(resolved).isFile()) {
        if (name === 'codex') {
          const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'))
          for (const directory of ['codex-hud', 'codex-hub']) {
            try {
              const state = JSON.parse(fs.readFileSync(path.join(codexHome, directory, 'install.json'), 'utf8')) as {
                realCodex?: unknown
                managedFiles?: unknown
              }
              if (
                Array.isArray(state.managedFiles)
                && state.managedFiles.map(value => path.resolve(String(value))).includes(resolved)
                && typeof state.realCodex === 'string'
              ) {
                fs.accessSync(state.realCodex, fs.constants.X_OK)
                return path.resolve(state.realCodex)
              }
            }
            catch {
              // Try the next canonical or legacy install-state location.
            }
          }
        }
        return resolved
      }
    }
    catch {
      // Continue searching PATH.
    }
  }
  // GUI-launched cmux panes can have a minimal PATH with no Codex or HUD
  // launcher at all. The managed install already records the real binary.
  if (name === 'codex' && !explicit) {
    const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'))
    for (const directory of ['codex-hud', 'codex-hub']) {
      try {
        const state = JSON.parse(fs.readFileSync(path.join(codexHome, directory, 'install.json'), 'utf8')) as {
          realCodex?: unknown
          managedFiles?: unknown
        }
        if (typeof state.realCodex !== 'string' || !path.isAbsolute(state.realCodex)) {
          continue
        }
        const resolved = path.resolve(state.realCodex)
        if (excluded.has(resolved)
          || (Array.isArray(state.managedFiles) && state.managedFiles.some(file => path.resolve(String(file)) === resolved))) {
          continue
        }
        fs.accessSync(resolved, fs.constants.X_OK)
        if (fs.statSync(resolved).isFile()) {
          return resolved
        }
      }
      catch {
        // Missing, stale, or invalid installation metadata is not executable.
      }
    }
  }
  return null
}

export function shellQuote(value: string): string {
  if (value.length === 0) {
    return '\'\''
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export function shellCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ')
}
