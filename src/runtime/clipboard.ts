import { spawnSync } from 'node:child_process'
import process from 'node:process'

export function copyText(value: string): boolean {
  const commands = process.platform === 'darwin'
    ? [['pbcopy', []] as const]
    : process.platform === 'win32'
      ? [['clip', []] as const]
      : [['wl-copy', []] as const, ['xclip', ['-selection', 'clipboard']] as const]

  for (const [command, args] of commands) {
    const result = spawnSync(command, args, {
      input: value,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    if (result.status === 0) {
      return true
    }
  }
  return false
}
