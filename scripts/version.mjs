#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packagePath = path.join(root, 'package.json')
const pluginPath = path.join(root, 'plugins', 'codex-hud', '.codex-plugin', 'plugin.json')
const changelogPath = path.join(root, 'CHANGELOG.md')
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?$/i

function fail(message) {
  process.stderr.write(`Version error: ${message}\n`)
  process.exitCode = 1
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function parseSemver(value) {
  const match = semverPattern.exec(value)
  if (!match) {
    throw new Error(`invalid SemVer ${JSON.stringify(value)}; build metadata is reserved for the Codex cachebuster`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  }
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] - right[key]
    }
  }
  if (left.prerelease === right.prerelease) {
    return 0
  }
  if (left.prerelease === null) {
    return 1
  }
  if (right.prerelease === null) {
    return -1
  }
  return left.prerelease.localeCompare(right.prerelease, 'en', { numeric: true })
}

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function nextCachebuster(currentVersion = '') {
  let date = new Date()
  let value = timestamp(date)
  while (currentVersion.endsWith(`+codex.${value}`)) {
    date = new Date(date.getTime() + 1000)
    value = timestamp(date)
  }
  return value
}

function hasReleaseHeading(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^## ${escaped}(?: - \\d{4}-\\d{2}-\\d{2})?$`, 'm').test(changelog)
}

function check() {
  const packageJson = readJson(packagePath)
  const plugin = readJson(pluginPath)
  const changelog = fs.readFileSync(changelogPath, 'utf8')

  try {
    parseSemver(packageJson.version)
  }
  catch (error) {
    fail(error.message)
    return
  }

  const expectedPrefix = `${packageJson.version}+codex.`
  if (!plugin.version.startsWith(expectedPrefix)) {
    fail(`plugin version ${plugin.version} must use package version ${packageJson.version} plus one +codex.<cachebuster> suffix`)
    return
  }
  const cachebuster = plugin.version.slice(expectedPrefix.length)
  if (!/^[0-9a-z-]+(?:\.[0-9a-z-]+)*$/i.test(cachebuster)) {
    fail(`invalid plugin cachebuster ${JSON.stringify(cachebuster)}`)
    return
  }
  if (!hasReleaseHeading(changelog, packageJson.version)) {
    fail(`CHANGELOG.md has no release heading for ${packageJson.version}`)
    return
  }
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    const expectedTag = `v${packageJson.version}`
    if (process.env.GITHUB_REF_NAME !== expectedTag) {
      fail(`Git tag ${process.env.GITHUB_REF_NAME} must match package version as ${expectedTag}`)
      return
    }
  }

  process.stdout.write(`Version OK: ${packageJson.version} (plugin ${plugin.version})\n`)
}

function refreshCachebuster() {
  const packageJson = readJson(packagePath)
  const plugin = readJson(pluginPath)
  parseSemver(packageJson.version)
  plugin.version = `${packageJson.version}+codex.${nextCachebuster(plugin.version)}`
  writeJson(pluginPath, plugin)
  process.stdout.write(`Updated plugin cachebuster: ${plugin.version}\n`)
}

function releaseNotes(version) {
  parseSemver(version)
  const changelog = fs.readFileSync(changelogPath, 'utf8')
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingPattern = new RegExp(`^## ${escaped}(?: - \\d{4}-\\d{2}-\\d{2})?$`, 'm')
  const heading = headingPattern.exec(changelog)
  if (!heading || heading.index === undefined) {
    throw new Error(`CHANGELOG.md has no release heading for ${version}`)
  }
  const contentStart = heading.index + heading[0].length
  const nextHeading = changelog.indexOf('\n## ', contentStart)
  const contentEnd = nextHeading < 0 ? changelog.length : nextHeading
  const notes = changelog.slice(contentStart, contentEnd).trim()
  if (!notes) {
    throw new Error(`CHANGELOG.md release ${version} has no notes`)
  }
  process.stdout.write(`${notes}\n`)
}

function prepare(version) {
  if (!version) {
    throw new Error('usage: pnpm release:prepare <version>')
  }
  const next = parseSemver(version)
  const packageJson = readJson(packagePath)
  const current = parseSemver(packageJson.version)
  if (compareSemver(next, current) <= 0) {
    throw new Error(`release version ${version} must be greater than current version ${packageJson.version}`)
  }

  let changelog = fs.readFileSync(changelogPath, 'utf8')
  const marker = '## [Unreleased]'
  const markerStart = changelog.indexOf(marker)
  if (markerStart < 0) {
    throw new Error('CHANGELOG.md must start with an ## [Unreleased] section')
  }
  const contentStart = markerStart + marker.length
  const nextHeading = changelog.indexOf('\n## ', contentStart)
  const contentEnd = nextHeading < 0 ? changelog.length : nextHeading
  const pendingChanges = changelog.slice(contentStart, contentEnd).trim()
  if (!pendingChanges) {
    throw new Error('CHANGELOG.md [Unreleased] section is empty')
  }

  packageJson.version = version
  writeJson(packagePath, packageJson)

  const plugin = readJson(pluginPath)
  plugin.version = `${version}+codex.${nextCachebuster(plugin.version)}`
  writeJson(pluginPath, plugin)

  const date = new Date().toISOString().slice(0, 10)
  const before = changelog.slice(0, markerStart)
  const after = changelog.slice(contentEnd).replace(/^\s+/, '')
  changelog = `${before}${marker}\n\n## ${version} - ${date}\n\n${pendingChanges}\n\n${after}`
  fs.writeFileSync(changelogPath, changelog)

  process.stdout.write(`Prepared ${version}. Review the changelog, run pnpm release:check, then commit and tag v${version}.\n`)
}

const [command = 'check', argument] = process.argv.slice(2)

try {
  if (command === 'check') {
    check()
  }
  else if (command === 'cachebuster') {
    refreshCachebuster()
  }
  else if (command === 'prepare') {
    prepare(argument)
  }
  else if (command === 'notes') {
    const packageJson = readJson(packagePath)
    releaseNotes(argument ?? packageJson.version)
  }
  else {
    throw new Error(`unknown command ${JSON.stringify(command)}`)
  }
}
catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
