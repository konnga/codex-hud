// @env node
import { spawnSync } from 'node:child_process'

export type PaneResizeRunner = (args: string[]) => { status: number | null }

export const INITIAL_HUD_PANE_HEIGHT = 5
export const DEFAULT_HUD_MAX_HEIGHT = 30

export function desiredPaneHeight(lineCount: number, maximum: number, minimum = INITIAL_HUD_PANE_HEIGHT): number {
  const safeMaximum = Math.max(minimum, Math.round(maximum))
  return Math.min(safeMaximum, Math.max(minimum, Math.round(lineCount)))
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
  desiredHeight: number,
  previousHeight: number | null,
  runner: PaneResizeRunner = args => spawnSync('cmux', args, { stdio: 'ignore' }),
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
