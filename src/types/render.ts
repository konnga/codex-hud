import type { HudConfig } from './config.js'
import type { HudState } from './state.js'

export interface RenderOptions {
  width: number
  height: number
  color: boolean
}

export interface RenderContext {
  config: HudConfig
  state: HudState
  options: RenderOptions
  now: Date
}
