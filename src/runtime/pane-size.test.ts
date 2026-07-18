import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HUD_MAX_HEIGHT,
  desiredPaneHeight,
  INITIAL_HUD_PANE_HEIGHT,
  resizeCmuxPane,
  resizeHudPane,
  viewportRenderHeight,
} from './pane-size.js'

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

  it('resizes only a tmux HUD pane and suppresses unchanged requests', () => {
    const run = vi.fn(() => ({ status: 0 }))
    expect(resizeHudPane(null, 7, null, run)).toBeNull()
    expect(resizeHudPane('%2', 7, 7, run)).toBe(7)
    expect(run).not.toHaveBeenCalled()
    expect(resizeHudPane('%2', 7, 12, run)).toBe(7)
    expect(run).toHaveBeenCalledWith(['resize-pane', '-t', '%2', '-y', '7'])
  })

  it('resizes only a cmux HUD pane and suppresses unchanged requests', () => {
    const run = vi.fn(() => ({ status: 0 }))
    expect(resizeCmuxPane(null, 7, null, run)).toBeNull()
    expect(resizeCmuxPane('pane-id', 7, 7, run)).toBe(7)
    expect(run).not.toHaveBeenCalled()
    expect(resizeCmuxPane('pane-id', 7, 12, run)).toBe(7)
    expect(run).toHaveBeenCalledWith(['resize-pane', '-t', 'pane-id', '-y', '7'])
  })
})
