// @env node
import { spawnSync } from 'node:child_process'

export type PaneResizeRunner = (args: string[]) => { status: number | null, stdout?: string }

export const INITIAL_HUD_PANE_HEIGHT = 5
export const DEFAULT_HUD_MAX_HEIGHT = 30
export const CMUX_RESIZE_POINTS_PER_ROW = 20
export const CMUX_MANUAL_RESIZE_TOLERANCE_ROWS = 1.5

export interface CmuxPaneGeometry {
  rows: number
  heightPoints: number
  containerHeightPoints: number
  pointsPerRow: number
}

export interface CmuxPaneResize {
  height: number | null
  issued: boolean
  fraction: number | null
}

export interface CmuxSettledHeight {
  height: number | null
  manual: boolean
}

const defaultCmuxRunner: PaneResizeRunner = (args) => {
  const result = spawnSync('cmux', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1_500,
  })
  return { status: result.status, stdout: typeof result.stdout === 'string' ? result.stdout : undefined }
}

export function viewportRenderHeight(maximum: number, rows: number | null | undefined): number {
  const safeMaximum = Math.max(1, Math.round(maximum))
  if (!rows || !Number.isFinite(rows)) {
    return safeMaximum
  }
  return Math.min(safeMaximum, Math.max(1, Math.floor(rows)))
}

export function desiredPaneHeight(lineCount: number, maximum: number, minimum = INITIAL_HUD_PANE_HEIGHT): number {
  const safeMaximum = Math.max(minimum, Math.round(maximum))
  return Math.min(safeMaximum, Math.max(minimum, Math.round(lineCount)))
}

export function resizeHudPane(
  paneId: string | null,
  desiredHeight: number,
  previousHeight: number | null,
  runner: PaneResizeRunner = args => ({ status: spawnSync('tmux', args, { stdio: 'ignore' }).status }),
): number | null {
  if (!paneId) {
    return null
  }
  if (previousHeight === desiredHeight) {
    return previousHeight
  }
  const result = runner(['resize-pane', '-t', paneId, '-y', String(desiredHeight)])
  return result.status === 0 ? desiredHeight : previousHeight
}

export function readCmuxPaneGeometry(
  workspaceId: string | null,
  paneId: string | null,
  runner: PaneResizeRunner = defaultCmuxRunner,
): CmuxPaneGeometry | null {
  if (!workspaceId || !paneId) {
    return null
  }
  const result = runner(['--json', '--id-format', 'both', 'list-panes', '--workspace', workspaceId])
  if (result.status !== 0 || !result.stdout) {
    return null
  }
  try {
    const payload = JSON.parse(result.stdout) as {
      container_frame?: { height?: unknown }
      panes?: Array<{ id?: unknown, rows?: unknown, pixel_frame?: { height?: unknown } }>
    }
    const containerHeightPoints = Number(payload.container_frame?.height)
    const pane = Array.isArray(payload.panes) ? payload.panes.find(entry => entry?.id === paneId) : undefined
    const rows = Number(pane?.rows)
    const heightPoints = Number(pane?.pixel_frame?.height)
    if (
      !pane
      || !Number.isFinite(rows) || rows <= 0
      || !Number.isFinite(heightPoints) || heightPoints <= 0
      || !Number.isFinite(containerHeightPoints) || containerHeightPoints <= 0
    ) {
      return null
    }
    // rows lag the divider while the workspace is hidden, so keep the estimate within sane bounds
    const pointsPerRow = Math.min(40, Math.max(12, heightPoints / rows))
    return { rows, heightPoints, containerHeightPoints, pointsPerRow }
  }
  catch {
    return null
  }
}

export function resizeCmuxPane(
  paneId: string | null,
  sourcePaneId: string | null,
  workspaceId: string | null,
  desiredHeight: number,
  currentRows: number | null | undefined,
  previousHeight: number | null,
  runner: PaneResizeRunner = defaultCmuxRunner,
): CmuxPaneResize {
  if (!paneId || !sourcePaneId || !workspaceId) {
    return { height: null, issued: false, fraction: null }
  }
  if (previousHeight === desiredHeight) {
    return { height: previousHeight, issued: false, fraction: null }
  }
  const geometry = readCmuxPaneGeometry(workspaceId, paneId, runner)
  const rows = geometry?.rows
    ?? (currentRows && Number.isFinite(currentRows) ? Math.floor(currentRows) : null)
  if (!rows) {
    return { height: null, issued: false, fraction: null }
  }
  const delta = Math.round(desiredHeight) - rows
  if (delta === 0) {
    return { height: desiredHeight, issued: false, fraction: null }
  }
  const growing = delta > 0
  const amount = Math.max(1, Math.round(Math.abs(delta) * (geometry?.pointsPerRow ?? CMUX_RESIZE_POINTS_PER_ROW)))
  const result = runner([
    'resize-pane',
    '--workspace',
    workspaceId,
    '--pane',
    growing ? paneId : sourcePaneId,
    growing ? '-U' : '-D',
    '--amount',
    String(amount),
  ])
  if (result.status !== 0) {
    return { height: previousHeight, issued: false, fraction: null }
  }
  const after = readCmuxPaneGeometry(workspaceId, paneId, runner)
  return {
    height: desiredHeight,
    issued: true,
    fraction: after ? after.heightPoints / after.containerHeightPoints : null,
  }
}

export function settleCmuxPaneHeight(
  currentRows: number | null | undefined,
  managedHeight: number | null,
  selfFraction: number | null,
  geometry: CmuxPaneGeometry | null,
): CmuxSettledHeight {
  if (geometry && selfFraction !== null) {
    // The divider position updates immediately even when PTY rows lag, so the pane's
    // share of the container is the ground truth for who moved it last.
    const expectedPoints = selfFraction * geometry.containerHeightPoints
    const tolerancePoints = geometry.pointsPerRow * CMUX_MANUAL_RESIZE_TOLERANCE_ROWS
    if (Math.abs(geometry.heightPoints - expectedPoints) > tolerancePoints) {
      return { height: managedHeight, manual: true }
    }
  }
  if (currentRows && Number.isFinite(currentRows)) {
    return { height: Math.floor(currentRows), manual: false }
  }
  return { height: managedHeight, manual: false }
}
