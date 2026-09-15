import os from 'node:os'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pathIdentity } from './path-identity.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('path identity', () => {
  it.skipIf(process.platform !== 'linux')('ignores case on Windows drive mounts in WSL', () => {
    vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')

    expect(pathIdentity('/mnt/d/__CodexHudFixture__/Project'))
      .toBe(pathIdentity('/mnt/d/__codexhudfixture__/project'))
  })

  it.skipIf(process.platform !== 'linux')('detects WSL from its kernel release when environment markers are absent', () => {
    vi.stubEnv('WSL_DISTRO_NAME', '')
    vi.stubEnv('WSL_INTEROP', '')
    vi.spyOn(os, 'release').mockReturnValue('6.6.87.2-microsoft-standard-WSL2')

    expect(pathIdentity('/mnt/d/__CodexHudFixture__/Project'))
      .toBe(pathIdentity('/mnt/d/__codexhudfixture__/project'))
  })

  it('keeps non-drive paths case-sensitive in WSL', () => {
    vi.stubEnv('WSL_DISTRO_NAME', 'Ubuntu')

    expect(pathIdentity('/mnt/storage/__CodexHudFixture__/Project'))
      .not
      .toBe(pathIdentity('/mnt/storage/__codexhudfixture__/project'))
  })

  it.skipIf(process.platform !== 'linux')('keeps Linux paths case-sensitive outside WSL', () => {
    vi.stubEnv('WSL_DISTRO_NAME', '')
    vi.stubEnv('WSL_INTEROP', '')
    vi.spyOn(os, 'release').mockReturnValue('6.8.0-generic')

    expect(pathIdentity('/mnt/d/__CodexHudFixture__/Project'))
      .not
      .toBe(pathIdentity('/mnt/d/__codexhudfixture__/project'))
  })
})
