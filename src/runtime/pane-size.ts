// @env node
import { spawnSync } from 'node:child_process'

export type PaneResizeRunner = (args: string[]) => { status: number | null }

export const INITIAL_HUD_PANE_HEIGHT = 5
export const DEFAULT_HUD_MAX_HEIGHT = 30
export const CMUX_RESIZE_POINTS_PER_ROW = 20

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

export function isExternalCmuxResize(
  currentRows: number | null | undefined,
  managedHeight: number | null,
): boolean {
  if (managedHeight === null || !currentRows || !Number.isFinite(currentRows)) {
    return false
  }
  return Math.floor(currentRows) !== managedHeight
}

export function resizeHudPane(
  paneId: string | null,
  desiredHeight: number,
  previousHeight: number | null,
  runner: PaneResizeRunner = args => spawnSync('tmux', args, { stdio: 'ignore' }),
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

export function resizeCmuxPane(
  paneId: string | null,
  sourcePaneId: string | null,
  workspaceId: string | null,
  desiredHeight: number,
  currentRows: number | null | undefined,
  previousHeight: number | null,
  runner: PaneResizeRunner = args => spawnSync('cmux', args, { stdio: 'ignore' }),
): number | null {
  if (!paneId || !sourcePaneId || !workspaceId || !currentRows || !Number.isFinite(currentRows)) {
    return null
  }
  if (previousHeight === desiredHeight) {
    return previousHeight
  }
  const delta = Math.round(desiredHeight) - Math.floor(currentRows)
  if (delta === 0) {
    return desiredHeight
  }
  const growing = delta > 0
  const result = runner([
    'resize-pane',
    '--workspace',
    workspaceId,
    '--pane',
    growing ? paneId : sourcePaneId,
    growing ? '-U' : '-D',
    '--amount',
    String(Math.abs(delta) * CMUX_RESIZE_POINTS_PER_ROW),
  ])
  return result.status === 0 ? desiredHeight : previousHeight
}
