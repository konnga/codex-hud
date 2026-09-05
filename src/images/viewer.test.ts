import type { SessionImage } from '../types/state.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createImagePreview, createImageViewerState, renderImageViewer } from './viewer.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixtureImage(): SessionImage {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-viewer-'))
  temporaryDirectories.push(directory)
  const imagePath = path.join(directory, 'generated.png')
  fs.writeFileSync(imagePath, 'not a real image')
  return {
    path: imagePath,
    source: 'generated_image',
    createdAt: new Date('2026-08-05T10:00:00Z'),
  }
}

describe('image viewer', () => {
  it('renders a selectable image list', () => {
    const image = fixtureImage()
    const state = createImageViewerState()
    state.active = true
    const lines = renderImageViewer([image], state, {
      width: 100,
      height: 10,
      color: false,
      language: 'en',
    })

    expect(lines.join('\n')).toContain('Image gallery · 1 images')
    expect(lines.join('\n')).toContain('generated.png')
    expect(lines.at(-1)).toContain('Enter preview')
  })

  it('provides metadata fallback when chafa is unavailable', () => {
    const image = fixtureImage()
    const lines = createImagePreview(image, 80, 12)
    expect(lines.join('\n')).toContain(`Path: ${image.path}`)
  })

  it('localizes the metadata fallback in Simplified Chinese', () => {
    const image = fixtureImage()
    const lines = createImagePreview(image, 80, 12, 'zh-Hans')
    expect(lines.join('\n')).toContain(`路径: ${image.path}`)
    expect(lines.join('\n')).toContain('内联预览需要安装 chafa。')
  })
})
