import type { DisplayConfig } from '../types/config.js'
import type { UsageData, UsageWindow } from '../types/state.js'
// @env node
import fs from 'node:fs'
import path from 'node:path'

interface SnapshotWindow {
  used_percentage?: number
  used_percent?: number
  resets_at?: string | number | null
  window_minutes?: number | null
}

interface UsageSnapshot {
  updated_at?: string | number
  five_hour?: SnapshotWindow | null
  seven_day?: SnapshotWindow | null
  individual?: SnapshotWindow | null
  balance_label?: string | null
}

const MAX_BALANCE_LABEL = 80
const WRITE_HEARTBEAT_MS = 60_000
const lastWrites = new Map<string, { fingerprint: string, at: number }>()

function safePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : null
}

function safeReset(value: unknown): Date | null {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }
  const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function sanitizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const label = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return label ? label.slice(0, MAX_BALANCE_LABEL) : null
}

function snapshotWindow(value: SnapshotWindow | null | undefined, label: string, fallbackMinutes: number): UsageWindow | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const percent = safePercent(value.used_percentage ?? value.used_percent)
  if (percent === null) {
    return null
  }
  return {
    label,
    percent,
    resetAt: safeReset(value.resets_at),
    windowMinutes: typeof value.window_minutes === 'number' && value.window_minutes > 0
      ? value.window_minutes
      : fallbackMinutes,
  }
}

function validSnapshotPath(filePath: string, write = false): boolean {
  if (!filePath || !path.isAbsolute(filePath) || !filePath.toLowerCase().endsWith('.json')) {
    return false
  }
  if (!write) {
    return true
  }
  try {
    return fs.statSync(path.dirname(filePath)).isDirectory()
  }
  catch {
    return false
  }
}

export function readExternalUsage(
  filePath: string,
  freshnessMs: number,
  now = new Date(),
): UsageData | null {
  if (!validSnapshotPath(filePath)) {
    return null
  }
  try {
    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8')) as UsageSnapshot
    const updatedAt = safeReset(snapshot.updated_at)
    if (!updatedAt || Math.abs(now.getTime() - updatedAt.getTime()) > freshnessMs) {
      return null
    }
    const primary = snapshotWindow(snapshot.five_hour, '5h', 300)
    const secondary = snapshotWindow(snapshot.seven_day, '1w', 10_080)
    const individual = snapshotWindow(snapshot.individual, 'spend', 43_200)
    const balanceLabel = sanitizeLabel(snapshot.balance_label)
    if (!primary && !secondary && !individual && !balanceLabel) {
      return null
    }
    return {
      primary,
      secondary,
      individual,
      planType: null,
      balanceLabel,
      limitReachedType: null,
    }
  }
  catch {
    return null
  }
}

function serializableWindow(window: UsageWindow | null): SnapshotWindow | null {
  if (!window || window.percent === null) {
    return null
  }
  return {
    used_percentage: window.percent,
    resets_at: window.resetAt?.toISOString() ?? null,
    window_minutes: window.windowMinutes ?? null,
  }
}

export function writeExternalUsage(filePath: string, usage: UsageData, now = new Date()): void {
  if (!validSnapshotPath(filePath, true)) {
    return
  }
  const content = {
    five_hour: serializableWindow(usage.primary),
    seven_day: serializableWindow(usage.secondary),
    individual: serializableWindow(usage.individual),
    balance_label: usage.balanceLabel,
  }
  const fingerprint = JSON.stringify(content)
  const previous = lastWrites.get(filePath)
  if (previous?.fingerprint === fingerprint && now.getTime() - previous.at < WRITE_HEARTBEAT_MS) {
    return
  }
  const snapshot: UsageSnapshot = { updated_at: now.toISOString(), ...content }
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.chmodSync(filePath, 0o600)
    lastWrites.set(filePath, { fingerprint, at: now.getTime() })
  }
  catch {
    // Sidecar snapshots are optional and must never break the HUD.
  }
}

export function resolveUsageData(
  nativeUsage: UsageData | null,
  display: Pick<DisplayConfig, 'externalUsagePath' | 'externalUsageWritePath' | 'externalUsageFreshnessMs'>,
  now = new Date(),
): UsageData | null {
  const external = readExternalUsage(display.externalUsagePath, display.externalUsageFreshnessMs, now)
  if (nativeUsage) {
    if (display.externalUsageWritePath) {
      writeExternalUsage(display.externalUsageWritePath, nativeUsage, now)
    }
    return external?.balanceLabel && !nativeUsage.balanceLabel
      ? { ...nativeUsage, balanceLabel: external.balanceLabel }
      : nativeUsage
  }
  return external
}
