import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runConfigure } from '../commands/configure.js'
import { DEFAULT_CONFIG } from '../types/config.js'
import { loadConfig } from './load.js'
import { createPreset } from './presets.js'
import { validateConfig } from './validate.js'
import { writeConfig } from './write.js'

const temporaryDirectories: string[] = []

function temporaryConfigEnv(): { directory: string, env: NodeJS.ProcessEnv, configPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-config-'))
  temporaryDirectories.push(directory)
  const configPath = path.join(directory, 'config.json')
  return {
    directory,
    env: { CODEX_HUD_CONFIG: configPath },
    configPath,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('configuration validation', () => {
  it('falls back field by field for malformed values', () => {
    const config = validateConfig({
      lineLayout: 'sideways',
      pathLevels: 99,
      refreshIntervalMs: 1,
      elementOrder: ['project', 'project', 'bogus', 'context'],
      colors: {
        context: '#12ff88',
        usage: 999,
        barFilled: 'xx',
        barEmpty: '\u001B',
      },
      display: {
        contextWarningThreshold: -5,
        contextCriticalThreshold: 120,
        customLine: '\u001B[2Junsafe',
      },
    })

    expect(config.lineLayout).toBe(DEFAULT_CONFIG.lineLayout)
    expect(config.pathLevels).toBe(3)
    expect(config.refreshIntervalMs).toBe(100)
    expect(config.elementOrder).toEqual(['project', 'context'])
    expect(config.colors.context).toBe('#12ff88')
    expect(config.colors.usage).toBe(DEFAULT_CONFIG.colors.usage)
    expect(config.colors.barFilled).toBe(DEFAULT_CONFIG.colors.barFilled)
    expect(config.colors.barEmpty).toBe(DEFAULT_CONFIG.colors.barEmpty)
    expect(config.display.contextWarningThreshold).toBe(0)
    expect(config.display.contextCriticalThreshold).toBe(100)
    expect(config.display.customLine).toBe('')
  })

  it('deduplicates merge groups without sharing one item across groups', () => {
    const config = validateConfig({
      display: {
        mergeGroups: [
          ['context', 'usage', 'context'],
          ['usage', 'tools', 'agents'],
        ],
      },
    })
    expect(config.display.mergeGroups).toEqual([
      ['context', 'usage'],
      ['tools', 'agents'],
    ])
  })

  it('normalizes Claude HUD language aliases', () => {
    expect(validateConfig({ language: 'zh' }).language).toBe('zh-Hans')
    expect(validateConfig({ language: 'zh-TW' }).language).toBe('zh-Hant')
  })
})

describe('configuration persistence', () => {
  it('loads defaults when the file is missing', () => {
    const { env } = temporaryConfigEnv()
    const loaded = loadConfig(env)
    expect(loaded.error).toBeNull()
    expect(loaded.config).toEqual(DEFAULT_CONFIG)
  })

  it('reports malformed JSON without crashing', () => {
    const { env, configPath } = temporaryConfigEnv()
    fs.writeFileSync(configPath, '{not-json', 'utf8')
    const loaded = loadConfig(env)
    expect(loaded.error).toBeInstanceOf(Error)
    expect(loaded.config).toEqual(DEFAULT_CONFIG)
  })

  it('preserves unknown advanced keys when writing guided changes', () => {
    const { env, configPath } = temporaryConfigEnv()
    const config = createPreset('essential')
    writeConfig(config, {
      futureFeature: { enabled: true },
      display: { futureToggle: 'keep-me' },
    }, env)
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, any>
    expect(parsed.futureFeature).toEqual({ enabled: true })
    expect(parsed.display.futureToggle).toBe('keep-me')
    expect(parsed.display.showTools).toBe(true)
  })

  it('preserves validated advanced overrides during preset configuration', async () => {
    const { env, configPath } = temporaryConfigEnv()
    const previous = process.env.CODEX_HUD_CONFIG
    process.env.CODEX_HUD_CONFIG = env.CODEX_HUD_CONFIG
    fs.writeFileSync(configPath, JSON.stringify({
      colors: { context: '#123456' },
      display: {
        timeFormat: 'both',
        autoCompactWindow: 80_000,
        externalUsagePath: '/tmp/usage.json',
      },
    }))
    try {
      expect(await runConfigure(['--preset', 'full', '--yes'])).toBe(0)
    }
    finally {
      if (previous === undefined)
        delete process.env.CODEX_HUD_CONFIG
      else process.env.CODEX_HUD_CONFIG = previous
    }
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.colors.context).toBe('#123456')
    expect(saved.display.timeFormat).toBe('both')
    expect(saved.display.autoCompactWindow).toBe(80_000)
    expect(saved.display.externalUsagePath).toBe('/tmp/usage.json')
  })
})

describe('configuration presets', () => {
  it('enables all activity in the full preset', () => {
    const config = createPreset('full')
    expect(config.display.showTools).toBe(true)
    expect(config.display.showSkills).toBe(true)
    expect(config.display.showMcp).toBe(true)
    expect(config.display.showAgents).toBe(true)
    expect(config.display.showTodos).toBe(true)
    expect(config.display.showPermissionProfile).toBe(true)
  })

  it('keeps the minimal preset focused on model, project, and context', () => {
    const config = createPreset('minimal')
    expect(config.lineLayout).toBe('compact')
    expect(config.elementOrder).toEqual(['project', 'context'])
    expect(config.display.showUsage).toBe(false)
    expect(config.display.showPermissionProfile).toBe(false)
  })
})
