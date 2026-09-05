import type { Language } from '../types/config.js'
import type { SessionImage } from '../types/state.js'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { truncateAnsi, visibleWidth } from '../render/format.js'
import { copyText } from '../runtime/clipboard.js'

export interface ImageViewerState {
  active: boolean
  view: 'list' | 'preview'
  selectedIndex: number
  previewScroll: number
  previewPath: string | null
  previewLines: string[]
}

export interface ImageViewerOptions {
  width: number
  height: number
  color: boolean
  language: Language
}

const LABELS = {
  'en': {
    title: 'Image gallery',
    images: 'images',
    noImages: 'No available images',
    missing: 'Image file is no longer available',
    listHelp: 'j/k move · Enter preview · o open · y copy path · q/Esc close',
    previewHelp: '←/→ previous/next · j/k scroll · o open · y copy path · q/Esc back',
    open: 'Open',
    copied: 'Path copied',
    unavailable: 'unavailable',
    path: 'Path',
    info: 'Info',
    inlineRequired: 'Inline preview requires chafa.',
    openHint: 'Press o to open with the system image viewer.',
  },
  'zh-Hans': {
    title: '图片画廊',
    images: '张图片',
    noImages: '没有可用图片',
    missing: '图片文件已不存在',
    listHelp: 'j/k 选择 · Enter 预览 · o 打开 · y 复制路径 · q/Esc 关闭',
    previewHelp: '←/→ 上一张/下一张 · j/k 滚动 · o 打开 · y 复制路径 · q/Esc 返回',
    open: '打开',
    copied: '路径已复制',
    unavailable: '不可用',
    path: '路径',
    info: '信息',
    inlineRequired: '内联预览需要安装 chafa。',
    openHint: '按 o 使用系统图片查看器打开。',
  },
} as const

export function createImageViewerState(): ImageViewerState {
  return {
    active: false,
    view: 'list',
    selectedIndex: 0,
    previewScroll: 0,
    previewPath: null,
    previewLines: [],
  }
}

function imageInfo(image: SessionImage, unavailable = 'unavailable'): string {
  try {
    const stat = fs.statSync(image.path)
    const size = stat.size < 1024 * 1024
      ? `${Math.max(1, Math.round(stat.size / 1024))} KB`
      : `${(stat.size / (1024 * 1024)).toFixed(1)} MB`
    return `${path.extname(image.path).slice(1).toUpperCase()} · ${size}`
  }
  catch {
    return unavailable
  }
}

function timeLabel(image: SessionImage): string {
  return image.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function padLine(value: string, width: number): string {
  const line = truncateAnsi(value, width)
  return `${line}${' '.repeat(Math.max(0, width - visibleWidth(line)))}`
}

function selectedIndex(state: ImageViewerState, images: SessionImage[]): number {
  if (images.length === 0) {
    state.selectedIndex = 0
    return 0
  }
  state.selectedIndex = Math.min(images.length - 1, Math.max(0, state.selectedIndex))
  return state.selectedIndex
}

export function renderImageViewer(
  images: SessionImage[],
  state: ImageViewerState,
  options: ImageViewerOptions,
): string[] {
  const labels = LABELS[options.language]
  const width = Math.max(24, options.width)
  const height = Math.max(8, options.height)
  if (state.view === 'preview' && images.length > 0) {
    const image = images[selectedIndex(state, images)]
    const header = `${labels.title} · ${String(state.selectedIndex + 1)}/${String(images.length)} · ${path.basename(image.path)}`
    const bodyHeight = Math.max(1, height - 2)
    const maximumScroll = Math.max(0, state.previewLines.length - bodyHeight)
    state.previewScroll = Math.min(maximumScroll, Math.max(0, state.previewScroll))
    return [
      truncateAnsi(header, width),
      ...state.previewLines.slice(state.previewScroll, state.previewScroll + bodyHeight).map(line => truncateAnsi(line, width)),
      truncateAnsi(labels.previewHelp, width),
    ].slice(0, height)
  }

  const header = `${labels.title} · ${String(images.length)} ${labels.images}`
  if (images.length === 0) {
    return [header, labels.noImages, labels.listHelp].map(line => truncateAnsi(line, width))
  }
  const rows = Math.max(1, height - 2)
  const start = Math.max(0, Math.min(state.selectedIndex - Math.floor(rows / 2), images.length - rows))
  const lines = [truncateAnsi(header, width)]
  for (let index = start; index < Math.min(images.length, start + rows); index += 1) {
    const image = images[index]
    const marker = index === selectedIndex(state, images) ? '> ' : '  '
    const row = `${marker}#${String(index + 1).padStart(2, '0')} ${timeLabel(image)} ${path.basename(image.path)} · ${imageInfo(image, labels.unavailable)}`
    lines.push(padLine(row, width))
  }
  lines.push(truncateAnsi(labels.listHelp, width))
  return lines.slice(0, height)
}

export function createImagePreview(image: SessionImage, width: number, height: number, language: Language = 'en'): string[] {
  const maxWidth = Math.max(20, width)
  const maxHeight = Math.max(4, height - 3)
  const result = spawnSync('chafa', [
    '--format',
    'symbols',
    '--colors',
    '256',
    '--size',
    `${String(maxWidth)}x${String(maxHeight)}`,
    '--animate',
    'off',
    image.path,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000 })
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.replace(/\r/g, '').trimEnd().split('\n')
  }
  const labels = LABELS[language]
  return [
    `${labels.path}: ${image.path}`,
    `${labels.info}: ${imageInfo(image, labels.unavailable)}`,
    '',
    labels.inlineRequired,
    labels.openHint,
  ]
}

export function openImage(image: SessionImage): void {
  if (process.platform === 'darwin') {
    spawnSync('open', [image.path], { stdio: 'ignore' })
  }
  else if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'start', '', image.path], { stdio: 'ignore' })
  }
  else {
    spawnSync('xdg-open', [image.path], { stdio: 'ignore' })
  }
}

export function copyImagePath(image: SessionImage): boolean {
  return copyText(image.path)
}
