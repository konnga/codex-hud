import type { HudColorValue } from '../types/config.js'

export const RESET = '\u001B[0m'

const NAMED_CODES: Record<string, number> = {
  dim: 2,
  red: 31,
  green: 32,
  yellow: 33,
  magenta: 35,
  cyan: 36,
  brightBlue: 94,
  brightMagenta: 95,
}

export function color(text: string, value: HudColorValue, enabled: boolean): string {
  if (!enabled || !text) {
    return text
  }
  if (typeof value === 'number') {
    return `\u001B[38;5;${value}m${text}${RESET}`
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) {
    const red = Number.parseInt(value.slice(1, 3), 16)
    const green = Number.parseInt(value.slice(3, 5), 16)
    const blue = Number.parseInt(value.slice(5, 7), 16)
    return `\u001B[38;2;${red};${green};${blue}m${text}${RESET}`
  }
  const code = NAMED_CODES[value]
  return code ? `\u001B[${code}m${text}${RESET}` : text
}

export function statusColor(
  percent: number,
  base: HudColorValue,
  warning: HudColorValue,
  critical: HudColorValue,
  warningThreshold: number,
  criticalThreshold: number,
): HudColorValue {
  if (percent >= criticalThreshold) {
    return critical
  }
  if (percent >= warningThreshold) {
    return warning
  }
  return base
}
