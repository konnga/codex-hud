import type { ProjectInfo } from '../types/state.js'
// @env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parse } from 'smol-toml'
import { getCodexHome } from '../config/paths.js'
import { findGitRoot } from './git.js'

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.pnpm',
  '.turbo',
  '.next',
  '.nuxt',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'target',
])
const PROJECT_CACHE_MS = 30_000
const projectCache = new Map<string, { at: number, value: ProjectInfo }>()

function isDirectory(value: string): boolean {
  try {
    return fs.statSync(value).isDirectory()
  }
  catch {
    return false
  }
}

function countNamedFiles(root: string, fileName: string, maxDepth = 6): number {
  if (!isDirectory(root)) {
    return 0
  }
  let count = 0
  const visit = (directory: string, depth: number): void => {
    if (depth > maxDepth) {
      return
    }
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    }
    catch {
      return
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === fileName) {
        count += 1
      }
      else if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
        visit(path.join(directory, entry.name), depth + 1)
      }
    }
  }
  visit(root, 0)
  return count
}

function countFiles(root: string, predicate: (name: string) => boolean): number {
  if (!isDirectory(root)) {
    return 0
  }
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && predicate(entry.name))
      .length
  }
  catch {
    return 0
  }
}

function countSkillDirectories(root: string): number {
  return countNamedFiles(root, 'SKILL.md', 8)
}

function readToml(filePath: string): Record<string, unknown> {
  try {
    const value = parse(fs.readFileSync(filePath, 'utf8'))
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }
  catch {
    return {}
  }
}

function tableSize(value: unknown): number {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : 0
}

function hookCountFromJson(filePath: string): number {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
    const hooks = value.hooks && typeof value.hooks === 'object' && !Array.isArray(value.hooks)
      ? value.hooks as Record<string, unknown>
      : value
    return Object.values(hooks).reduce<number>(
      (total, entry) => total + (Array.isArray(entry) ? entry.length : 0),
      0,
    )
  }
  catch {
    return 0
  }
}

export function collectProjectInfo(
  cwd: string,
  workspaceRoots: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
  includeCounts = true,
  now = Date.now(),
): ProjectInfo {
  const codexHome = getCodexHome(env)
  const projectRoot = findGitRoot(cwd) ?? path.resolve(cwd)
  const roots = Array.from(new Set([projectRoot, ...workspaceRoots.map(root => path.resolve(root))]))
  const cacheKey = `${codexHome}:${projectRoot}:${includeCounts}:${roots.join('\0')}`
  const cached = projectCache.get(cacheKey)
  if (cached && now - cached.at < PROJECT_CACHE_MS) {
    return structuredClone(cached.value)
  }
  const globalConfigPath = path.join(codexHome, 'config.toml')
  const projectConfigPath = path.join(projectRoot, '.codex', 'config.toml')
  const globalConfig = includeCounts ? readToml(globalConfigPath) : {}
  const projectConfig = includeCounts ? readToml(projectConfigPath) : {}
  const configCount = includeCounts
    ? [globalConfigPath, projectConfigPath].filter(filePath => fs.existsSync(filePath)).length
    : 0
  const globalHooksPath = path.join(codexHome, 'hooks.json')
  const projectHooksPath = path.join(projectRoot, '.codex', 'hooks.json')

  const value: ProjectInfo = {
    cwd: path.resolve(cwd),
    projectRoot,
    projectName: path.basename(projectRoot),
    workspaceRoots: roots,
    agentsMdCount: includeCounts ? roots.reduce((total, root) => total + countNamedFiles(root, 'AGENTS.md'), 0) : 0,
    codexConfigCount: includeCounts ? configCount : 0,
    rulesCount: includeCounts
      ? countFiles(path.join(codexHome, 'rules'), name => name.endsWith('.rules'))
      + countFiles(path.join(projectRoot, '.codex', 'rules'), name => name.endsWith('.rules'))
      : 0,
    hooksCount: includeCounts
      ? hookCountFromJson(globalHooksPath) + hookCountFromJson(projectHooksPath)
      + tableSize(globalConfig.hooks) + tableSize(projectConfig.hooks)
      : 0,
    skillsCount: includeCounts
      ? countSkillDirectories(path.join(codexHome, 'skills'))
      + countSkillDirectories(path.join(projectRoot, '.codex', 'skills'))
      : 0,
    pluginsCount: includeCounts ? tableSize(globalConfig.plugins) + tableSize(projectConfig.plugins) : 0,
    mcpCount: includeCounts ? tableSize(globalConfig.mcp_servers) + tableSize(projectConfig.mcp_servers) : 0,
  }
  projectCache.set(cacheKey, { at: now, value })
  return structuredClone(value)
}
