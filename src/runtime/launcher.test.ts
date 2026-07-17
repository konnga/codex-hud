import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it } from 'vitest'
import { isResumeInvocation, launchCodex, runCodexChild, waitForTmuxClient } from './launcher.js'
import { readSessionBinding } from './session-binding.js'

const directories: string[] = []
const originalEnv = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, originalEnv)
  directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

function executable(directory: string, name: string, source: string): string {
  const filePath = path.join(directory, name)
  fs.writeFileSync(filePath, `#!/bin/sh\n${source}\n`, { mode: 0o755 })
  return filePath
}

function fixture(tmuxSource?: string): { cwd: string, env: NodeJS.ProcessEnv, output: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-launcher-'))
  directories.push(root)
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  const output = path.join(root, 'codex-args.txt')
  const codex = executable(bin, 'codex', `printf '%s\\n' "$@" > '${output}'; exit 23`)
  if (tmuxSource)
    executable(bin, 'tmux', tmuxSource)
  return {
    cwd: root,
    output,
    env: {
      ...process.env,
      PATH: bin,
      CODEX_HOME: path.join(root, 'codex-home'),
      CODEX_HUD_CODEX_BIN: codex,
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('non-interfering launcher', () => {
  it('distinguishes resume flows from ordinary new sessions', () => {
    expect(isResumeInvocation(['resume', '--last'])).toBe(true)
    expect(isResumeInvocation(['--model', 'gpt-test', 'resume', '--last'])).toBe(true)
    expect(isResumeInvocation(['Implement resume support'])).toBe(false)
    expect(isResumeInvocation([])).toBe(false)
  })

  it('waits until a real tmux client is attached before starting interactive Codex', () => {
    const states = [0, 0, 1]
    const pauses: number[] = []
    expect(waitForTmuxClient('session', 1_000, () => states.shift() ?? 1, value => pauses.push(value))).toBe(true)
    expect(pauses).toEqual([50, 50])
  })

  it('runs official Codex directly when tmux is unavailable', () => {
    const { cwd, env, output } = fixture()
    const result = launchCodex({ cwd, env, codexArgs: ['--model', 'gpt-test'], height: 8, detached: false, noHud: false })
    expect(result).toMatchObject({ hudPaneId: null, sessionName: null, exitCode: 23 })
    expect(fs.readFileSync(output, 'utf8')).toBe('--model\ngpt-test\n')
  })

  it('runs official Codex directly when tmux cannot create the HUD pane', () => {
    const { cwd, env, output } = fixture('exit 1')
    env.TMUX = '/tmp/tmux'
    env.TMUX_PANE = '%1'
    const result = launchCodex({ cwd, env, codexArgs: ['resume', '--last'], height: 8, detached: false, noHud: false })
    expect(result.exitCode).toBe(23)
    expect(result.hudPaneId).toBeNull()
    expect(fs.readFileSync(output, 'utf8')).toBe('resume\n--last\n')
  })

  it('uses a launch-private tmux socket outside an existing tmux session', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-private-tmux-'))
    directories.push(root)
    const log = path.join(root, 'tmux-args.txt')
    const { cwd, env } = fixture([
      `printf '%s\\n' "$*" >> '${log}'`,
      `case " $* " in *" split-window "*) printf '%%2\\n' ;; esac`,
      'exit 0',
    ].join('\n'))
    env.CODEX_HOME = path.join(root, 'codex-home')

    const launched = launchCodex({ cwd, env, codexArgs: [], height: 8, detached: true, noHud: false })
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n')
    expect(launched.socketPath).toMatch(/codex-home\/codex-hud\/tmux\/.+\.sock$/)
    expect(fs.statSync(path.dirname(launched.socketPath!)).mode & 0o777).toBe(0o700)
    expect(calls.every(call => call.startsWith(`-S ${launched.socketPath} `))).toBe(true)
    expect(calls.some(call => call.includes(`-f ${os.devNull} new-session`))).toBe(true)
    expect(calls.some(call => call.includes('has-session'))).toBe(false)
  })

  it('falls back to official Codex when the private tmux socket cannot be created', () => {
    const { cwd, env, output } = fixture('exit 0')
    const blockedHome = path.join(cwd, 'blocked-codex-home')
    fs.writeFileSync(blockedHome, 'not a directory')
    env.CODEX_HOME = blockedHome

    const launched = launchCodex({
      cwd,
      env,
      codexArgs: ['resume', '--last'],
      height: 8,
      detached: false,
      noHud: false,
    })

    expect(launched).toMatchObject({ socketPath: null, exitCode: 23 })
    expect(fs.readFileSync(output, 'utf8')).toBe('resume\n--last\n')
  })

  it('binds the child to the rollout created by that Codex process', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-child-'))
    directories.push(root)
    const cwd = path.join(root, 'project')
    const codexHome = path.join(root, 'codex-home')
    const sessions = path.join(codexHome, 'sessions', '2026', '07', '17')
    const bindingPath = path.join(root, 'binding.json')
    fs.mkdirSync(cwd)
    fs.mkdirSync(sessions, { recursive: true })
    const codex = executable(root, 'codex', [
      `mkdir -p '${sessions}'`,
      `printf '%s\\n' '{"timestamp":"2026-07-17T02:00:00Z","type":"session_meta","payload":{"id":"owned","timestamp":"2026-07-17T02:00:00Z","cwd":"${cwd}","source":"cli"}}' > '${path.join(sessions, 'rollout-owned.jsonl')}'`,
      'sleep 0.2',
      'exit 17',
    ].join('\n'))
    process.env.CODEX_HOME = codexHome
    process.env.CODEX_HUD_CODEX_BIN = codex

    const child = runCodexChild([], null, false, cwd, bindingPath)
    await waitFor(() => readSessionBinding(bindingPath) !== null)
    expect(readSessionBinding(bindingPath)).toBe(path.join(sessions, 'rollout-owned.jsonl'))
    expect(await child).toBe(17)
    expect(readSessionBinding(bindingPath)).toBeNull()
  })

  it('returns promptly when Codex exits before creating a rollout', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-child-'))
    directories.push(root)
    const cwd = path.join(root, 'project')
    const codexHome = path.join(root, 'codex-home')
    const bindingPath = path.join(root, 'binding.json')
    fs.mkdirSync(cwd)
    const codex = executable(root, 'codex', 'exit 29')
    process.env.CODEX_HOME = codexHome
    process.env.CODEX_HUD_CODEX_BIN = codex
    const startedAt = Date.now()

    expect(await runCodexChild([], null, false, cwd, bindingPath)).toBe(29)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })
})
