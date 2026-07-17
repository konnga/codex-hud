import type { TimeFormatMode } from '../types/config.js'
import sliceAnsi from 'slice-ansi'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'

export function safeText(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('').replace(/\s+/g, ' ').trim()
}

export function visibleWidth(value: string): number {
  return stringWidth(stripAnsi(value))
}

export function truncateAnsi(value: string, width: number): string {
  if (width <= 0) {
    return ''
  }
  if (visibleWidth(value) <= width) {
    return value
  }
  if (width === 1) {
    return '…'
  }
  const reset = value === stripAnsi(value) ? '' : '\u001B[0m'
  return `${sliceAnsi(value, 0, width - 1)}…${reset}`
}

export function formatTokens(value: number): string {
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(Math.round(value))
}

export function formatDuration(milliseconds: number): string {
  return formatMinuteDuration(milliseconds, 'floor')
}

export function formatMinuteDuration(milliseconds: number, rounding: 'ceil' | 'floor'): string {
  const safeMilliseconds = Math.max(0, milliseconds)
  if (safeMilliseconds < 60_000) {
    return '<1m'
  }
  const minutes = Math[rounding](safeMilliseconds / 60_000)
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const remainingMinutes = minutes % 60
  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (remainingMinutes > 0) {
    parts.push(`${remainingMinutes}m`)
  }
  return parts.join(' ')
}

function relativeTime(resetAt: Date, now: Date): string {
  const milliseconds = Math.max(0, resetAt.getTime() - now.getTime())
  return formatMinuteDuration(milliseconds, 'ceil')
}

export function formatResetTime(
  resetAt: Date | null,
  now: Date,
  mode: TimeFormatMode,
  windowMinutes?: number | null,
): string | null {
  if (!resetAt) {
    return null
  }
  const relative = relativeTime(resetAt, now)
  const absolute = resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (mode === 'absolute') {
    return absolute
  }
  if (mode === 'both') {
    return `${relative} (${absolute})`
  }
  if (mode === 'elapsed' || mode === 'elapsedAndAbsolute') {
    if (!windowMinutes || windowMinutes <= 0) {
      return mode === 'elapsedAndAbsolute' ? absolute : relative
    }
    const remaining = Math.max(0, resetAt.getTime() - now.getTime())
    const elapsedPercent = Math.min(100, Math.max(0, Math.round(100 - (remaining / (windowMinutes * 60_000)) * 100)))
    return mode === 'elapsedAndAbsolute' ? `${elapsedPercent}% elapsed (${absolute})` : `${elapsedPercent}% elapsed`
  }
  return relative
}

export function progressBar(percent: number, width: number, filled: string, empty: string): string {
  const safeWidth = Math.max(1, width)
  const filledCount = Math.round((Math.min(100, Math.max(0, percent)) / 100) * safeWidth)
  return `${filled.repeat(filledCount)}${empty.repeat(safeWidth - filledCount)}`
}

export function projectPath(value: string, levels: 1 | 2 | 3): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  return parts.slice(-levels).join('/') || normalized
}
