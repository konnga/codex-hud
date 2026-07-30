import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HUD_MAX_HEIGHT,
  desiredPaneHeight,
  hudRenderHeight,
  INITIAL_HUD_PANE_HEIGHT,
  readCmuxPaneGeometry,
  resizeCmuxPane,
  resizeHudPane,
  settleCmuxPaneHeight,
  viewportRenderHeight,
} from './pane-size.js'

interface FakePaneState {
  rows: number
  height: number
  container: number
  resizeStatus?: number
  onResize?: (args: string[]) => void
}

function fakeCmuxRunner(state: FakePaneState) {
  return vi.fn((args: string[]) => {
    if (args.includes('list-panes')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          container_frame: { height: state.container },
          panes: [
            { id: 'other', rows: 40, pixel_frame: { height: state.container - state.height } },
            { id: 'hud', rows: state.rows, pixel_frame: { height: state.height } },
          ],
        }),
      }
    }
    state.onResize?.(args)
    return { status: state.resizeStatus ?? 0 }
  })
}

describe('adaptive HUD pane sizing', () => {
  it('defaults to a small initial pane with enough headroom for the full HUD', () => {
    expect(INITIAL_HUD_PANE_HEIGHT).toBe(5)
    expect(DEFAULT_HUD_MAX_HEIGHT).toBe(30)
    expect(desiredPaneHeight(10, DEFAULT_HUD_MAX_HEIGHT)).toBe(10)
  })

  it('fits content between the minimum and configured maximum', () => {
    expect(desiredPaneHeight(0, 12)).toBe(5)
    expect(desiredPaneHeight(7, 12)).toBe(7)
    expect(desiredPaneHeight(20, 12)).toBe(12)
  })

  it('limits rendering to the visible terminal viewport', () => {
    expect(viewportRenderHeight(30, 8)).toBe(8)
    expect(viewportRenderHeight(12, 20)).toBe(12)
    expect(viewportRenderHeight(12, undefined)).toBe(12)
    expect(viewportRenderHeight(12, 0)).toBe(12)
  })

  it('measures complete content before growing an automatically managed startup pane', () => {
    expect(hudRenderHeight(30, INITIAL_HUD_PANE_HEIGHT, false)).toBe(30)
    expect(desiredPaneHeight(7, hudRenderHeight(30, INITIAL_HUD_PANE_HEIGHT, false))).toBe(7)
    expect(hudRenderHeight(30, INITIAL_HUD_PANE_HEIGHT, true)).toBe(5)
  })

  it('resizes only a tmux HUD pane and suppresses unchanged requests', () => {
    const run = vi.fn(() => ({ status: 0 }))
    expect(resizeHudPane(null, 7, null, run)).toBeNull()
    expect(resizeHudPane('%2', 7, 7, run)).toBe(7)
    expect(run).not.toHaveBeenCalled()
    expect(resizeHudPane('%2', 7, 12, run)).toBe(7)
    expect(run).toHaveBeenCalledWith(['resize-pane', '-t', '%2', '-y', '7'])
  })
})

describe('cmux pane geometry', () => {
  it('reads rows, divider height, and container height for the HUD pane', () => {
    const run = fakeCmuxRunner({ rows: 20, height: 376, container: 1009 })

    const geometry = readCmuxPaneGeometry('ws', 'hud', run)

    expect(run).toHaveBeenCalledWith(['--json', '--id-format', 'both', 'list-panes', '--workspace', 'ws'])
    expect(geometry).toMatchObject({ rows: 20, heightPoints: 376, containerHeightPoints: 1009 })
    expect(geometry?.pointsPerRow).toBeCloseTo(18.8, 1)
  })

  it('keeps the points-per-row estimate within sane bounds when rows lag the divider', () => {
    expect(readCmuxPaneGeometry('ws', 'hud', fakeCmuxRunner({ rows: 20, height: 166, container: 1009 }))?.pointsPerRow).toBe(12)
    expect(readCmuxPaneGeometry('ws', 'hud', fakeCmuxRunner({ rows: 2, height: 400, container: 1009 }))?.pointsPerRow).toBe(40)
  })

  it('returns null for missing context, command failure, or an unknown pane', () => {
    expect(readCmuxPaneGeometry(null, 'hud', fakeCmuxRunner({ rows: 5, height: 90, container: 900 }))).toBeNull()
    expect(readCmuxPaneGeometry('ws', null, fakeCmuxRunner({ rows: 5, height: 90, container: 900 }))).toBeNull()
    expect(readCmuxPaneGeometry('ws', 'hud', vi.fn(() => ({ status: 1 })))).toBeNull()
    expect(readCmuxPaneGeometry('ws', 'hud', vi.fn(() => ({ status: 0, stdout: 'not json' })))).toBeNull()
    expect(readCmuxPaneGeometry('ws', 'missing', fakeCmuxRunner({ rows: 5, height: 90, container: 900 }))).toBeNull()
  })
})

describe('cmux pane resizing', () => {
  it('grows the HUD pane using the measured points-per-row', () => {
    const state: FakePaneState = { rows: 4, height: 72, container: 720 }
    state.onResize = () => {
      state.height = 126
      state.rows = 7
    }
    const run = fakeCmuxRunner(state)

    const resized = resizeCmuxPane('hud', 'source', 'ws', 7, 4, null, run)

    expect(run).toHaveBeenCalledWith([
      'resize-pane',
      '--workspace',
      'ws',
      '--pane',
      'hud',
      '-U',
      '--amount',
      '54',
    ])
    expect(resized.height).toBe(7)
    expect(resized.issued).toBe(true)
    expect(resized.fraction).toBeCloseTo(126 / 720, 5)
  })

  it('shrinks by growing the source pane downward', () => {
    const state: FakePaneState = { rows: 9, height: 162, container: 720 }
    const run = fakeCmuxRunner(state)

    const resized = resizeCmuxPane('hud', 'source', 'ws', 7, 9, null, run)

    expect(run).toHaveBeenCalledWith([
      'resize-pane',
      '--workspace',
      'ws',
      '--pane',
      'source',
      '-D',
      '--amount',
      '36',
    ])
    expect(resized.issued).toBe(true)
  })

  it('suppresses repeat requests and no-op deltas without issuing commands', () => {
    const run = fakeCmuxRunner({ rows: 7, height: 126, container: 720 })

    expect(resizeCmuxPane('hud', 'source', 'ws', 7, 12, 7, run)).toEqual({ height: 7, issued: false, fraction: null })
    expect(run).not.toHaveBeenCalled()
    expect(resizeCmuxPane('hud', 'source', 'ws', 7, 4, null, run)).toEqual({ height: 7, issued: false, fraction: null })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('falls back to the viewport rows and default ratio when geometry is unavailable', () => {
    const run = vi.fn((args: string[]) => (args.includes('list-panes') ? { status: 1 } : { status: 0 }))

    const resized = resizeCmuxPane('hud', 'source', 'ws', 7, 4, null, run)

    expect(run).toHaveBeenCalledWith([
      'resize-pane',
      '--workspace',
      'ws',
      '--pane',
      'hud',
      '-U',
      '--amount',
      '60',
    ])
    expect(resized).toEqual({ height: 7, issued: true, fraction: null })
  })

  it('keeps the previous height when the resize command fails or context is missing', () => {
    expect(resizeCmuxPane(null, 'source', 'ws', 7, 4, null, fakeCmuxRunner({ rows: 4, height: 72, container: 720 })))
      .toEqual({ height: null, issued: false, fraction: null })
    expect(resizeCmuxPane('hud', 'source', 'ws', 7, 4, 4, fakeCmuxRunner({ rows: 4, height: 72, container: 720, resizeStatus: 1 })))
      .toEqual({ height: 4, issued: false, fraction: null })
  })
})

describe('cmux resize settlement', () => {
  it('adopts the actual rows when the divider still sits where the HUD left it', () => {
    const geometry = { rows: 20, heightPoints: 376, containerHeightPoints: 1009, pointsPerRow: 18.8 }

    expect(settleCmuxPaneHeight(20, 30, 376 / 1009, geometry)).toEqual({ height: 20, manual: false })
  })

  it('keeps adopting after a window resize that preserves the pane fraction', () => {
    const geometry = { rows: 26, heightPoints: 470, containerHeightPoints: 1261, pointsPerRow: 18.1 }

    expect(settleCmuxPaneHeight(26, 20, 376 / 1009, geometry)).toEqual({ height: 26, manual: false })
  })

  it('hands height ownership to the user when the divider moved beyond tolerance', () => {
    const geometry = { rows: 12, heightPoints: 226, containerHeightPoints: 1009, pointsPerRow: 18.8 }

    expect(settleCmuxPaneHeight(12, 20, 376 / 1009, geometry)).toEqual({ height: 20, manual: true })
  })

  it('never latches manual mode without geometry or a recorded self fraction', () => {
    expect(settleCmuxPaneHeight(12, 20, null, { rows: 12, heightPoints: 226, containerHeightPoints: 1009, pointsPerRow: 18.8 }))
      .toEqual({ height: 12, manual: false })
    expect(settleCmuxPaneHeight(12, 20, 376 / 1009, null)).toEqual({ height: 12, manual: false })
    expect(settleCmuxPaneHeight(undefined, 20, null, null)).toEqual({ height: 20, manual: false })
  })
})
