import { describe, expect, it, vi } from 'vitest'
import { desiredPaneHeight, resizeHudPane } from './pane-size.js'

describe('adaptive HUD pane sizing', () => {
  it('fits content between the minimum and configured maximum', () => {
    expect(desiredPaneHeight(0, 12)).toBe(5)
    expect(desiredPaneHeight(7, 12)).toBe(7)
    expect(desiredPaneHeight(20, 12)).toBe(12)
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
