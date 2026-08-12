import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runConfigure } from '../commands/configure.js'
import { DEFAULT_CONFIG } from '../types/config.js'
import { loadConfig } from './load.js'
import { CURRENT_CONFIG_VERSION, migrateConfig } from './migrate.js'
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
  vi.restoreAllMocks()
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
    expect(config.elementOrder).toEqual(['project', 'context', 'turns'])
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

  it('validates opt-in external usage queries', () => {
    const config = validateConfig({
      display: {
        externalUsageQueries: [
          {
            enabled: true,
            origin: 'https://Relay.Example.com/v1',
            template: 'newApi',
            apiKeyEnv: '',
            accessTokenEnv: 'RELAY_TOKEN',
            userIdEnv: 'RELAY_USER',
            refreshMs: 1,
            quotaPerCredit: 500_000,
          },
          {
            enabled: true,
            origin: 'file:///tmp/unsafe',
            template: 'sub2Api',
            apiKeyEnv: '',
            accessTokenEnv: 'SUB2_TOKEN',
          },
        ],
      },
    })

    expect(config.display.externalUsageQueries).toEqual([{
      enabled: true,
      origin: 'https://relay.example.com',
      template: 'newApi',
      apiKeyEnv: '',
      accessTokenEnv: 'RELAY_TOKEN',
      userIdEnv: 'RELAY_USER',
      refreshMs: 10_000,
      quotaPerCredit: 500_000,
    }])
    expect(DEFAULT_CONFIG.display.externalUsageQueries).toMatchObject([{
      enabled: true,
      origin: '*',
      template: 'general',
    }])
  })

  it('allows the default relay balance query to be explicitly disabled', () => {
    expect(validateConfig({ display: { externalUsageQueries: [] } }).display.externalUsageQueries).toEqual([])
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
    expect(parsed.configVersion).toBe(CURRENT_CONFIG_VERSION)
  })

  it('preserves configuration versions newer than this runtime', () => {
    const { env, configPath } = temporaryConfigEnv()
    writeConfig(createPreset('essential'), { configVersion: 99 }, env)

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(parsed.configVersion).toBe(99)
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

  it('selectively updates named elements without resetting the current config', async () => {
    const { env, configPath } = temporaryConfigEnv()
    const previous = process.env.CODEX_HUD_CONFIG
    process.env.CODEX_HUD_CONFIG = env.CODEX_HUD_CONFIG
    fs.writeFileSync(configPath, JSON.stringify({
      language: 'zh-Hans',
      colors: { context: '#123456' },
      futureFeature: { enabled: true },
      display: {
        showTools: false,
        showSkills: false,
        showMemoryUsage: true,
        showGoal: true,
        timeFormat: 'both',
        futureToggle: 'keep-me',
      },
    }))
    try {
      expect(await runConfigure([
        '--enable',
        'tools,skills,agents',
        '--disable',
        'memory,goal',
        '--yes',
      ])).toBe(0)
    }
    finally {
      if (previous === undefined)
        delete process.env.CODEX_HUD_CONFIG
      else process.env.CODEX_HUD_CONFIG = previous
    }

    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(saved.language).toBe('zh-Hans')
    expect(saved.colors.context).toBe('#123456')
    expect(saved.futureFeature).toEqual({ enabled: true })
    expect(saved.display.futureToggle).toBe('keep-me')
    expect(saved.display.timeFormat).toBe('both')
    expect(saved.display.showTools).toBe(true)
    expect(saved.display.showSkills).toBe(true)
    expect(saved.display.showAgents).toBe(true)
    expect(saved.display.showMemoryUsage).toBe(false)
    expect(saved.display.showGoal).toBe(false)
  })

  it('prints the current guided configuration as JSON without writing', async () => {
    const { env, configPath } = temporaryConfigEnv()
    const previous = process.env.CODEX_HUD_CONFIG
    process.env.CODEX_HUD_CONFIG = env.CODEX_HUD_CONFIG
    writeConfig(createPreset('full'), {}, env)
    const before = fs.statSync(configPath).mtimeMs
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      expect(await runConfigure(['--status', '--json'])).toBe(0)
    }
    finally {
      if (previous === undefined)
        delete process.env.CODEX_HUD_CONFIG
      else process.env.CODEX_HUD_CONFIG = previous
    }

    const report = JSON.parse(String(output.mock.calls[0]?.[0]))
    expect(report).toMatchObject({
      configPath,
      language: 'en',
      layout: 'expanded',
    })
    expect(report.enabled).toContain('tools')
    expect(report.disabled).toContain('memory')
    expect(fs.statSync(configPath).mtimeMs).toBe(before)
  })
})

describe('configuration migrations', () => {
  it('enables git file stats once for an unversioned legacy config', () => {
    const { env, configPath } = temporaryConfigEnv()
    fs.writeFileSync(configPath, JSON.stringify({
      language: 'zh-Hans',
      futureFeature: { enabled: true },
      gitStatus: { showFileStats: false },
    }))

    expect(loadConfig(env).config.gitStatus.showFileStats).toBe(true)
    expect(migrateConfig({ env })).toMatchObject({ migrated: true, fromVersion: 0 })
    const migrated = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(migrated.configVersion).toBe(CURRENT_CONFIG_VERSION)
    expect(migrated.gitStatus.showFileStats).toBe(true)
    expect(migrated.futureFeature).toEqual({ enabled: true })

    migrated.gitStatus.showFileStats = false
    fs.writeFileSync(configPath, JSON.stringify(migrated))
    expect(migrateConfig({ env })).toMatchObject({ migrated: false, fromVersion: CURRENT_CONFIG_VERSION })
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).gitStatus.showFileStats).toBe(false)
  })

  it('does not rewrite malformed or future-version config files', () => {
    const malformed = temporaryConfigEnv()
    fs.writeFileSync(malformed.configPath, '{not-json', 'utf8')
    expect(migrateConfig({ env: malformed.env }).migrated).toBe(false)
    expect(fs.readFileSync(malformed.configPath, 'utf8')).toBe('{not-json')

    const future = temporaryConfigEnv()
    fs.writeFileSync(future.configPath, JSON.stringify({
      configVersion: 99,
      gitStatus: { showFileStats: false },
    }))
    expect(migrateConfig({ env: future.env })).toMatchObject({ migrated: false, fromVersion: 99 })
    expect(JSON.parse(fs.readFileSync(future.configPath, 'utf8')).gitStatus.showFileStats).toBe(false)
  })

  it('reports a dry-run migration without changing the config file', () => {
    const { env, configPath } = temporaryConfigEnv()
    const source = JSON.stringify({ gitStatus: { showFileStats: false } })
    fs.writeFileSync(configPath, source)

    expect(migrateConfig({ env, dryRun: true })).toMatchObject({ migrated: true, fromVersion: 0 })
    expect(fs.readFileSync(configPath, 'utf8')).toBe(source)
  })
})

describe('configuration presets', () => {
  it('enables all activity in the full preset', () => {
    const config = createPreset('full')
    expect(config.display.showModel).toBe(true)
    expect(config.display.showSessionName).toBe(false)
    expect(config.display.showTools).toBe(true)
    expect(config.display.showSkills).toBe(true)
    expect(config.display.showMcp).toBe(true)
    expect(config.display.showAgents).toBe(true)
    expect(config.display.showTodos).toBe(true)
    expect(config.display.showPermissionProfile).toBe(true)
    expect(config.display.showSessionTokens).toBe(true)
  })

  it('keeps the minimal preset focused on model, project, and context', () => {
    const config = createPreset('minimal')
    expect(config.lineLayout).toBe('compact')
    expect(config.elementOrder).toEqual(['project', 'context'])
    expect(config.display.showUsage).toBe(false)
    expect(config.display.showPermissionProfile).toBe(false)
  })
})
