const NON_INTERACTIVE_COMMANDS = new Set([
  'app-server',
  'app',
  'apply',
  'cloud',
  'completion',
  'debug',
  'exec',
  'features',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'plugin',
  'review',
  'sandbox',
])

const OPTIONS_WITH_VALUES = new Set([
  '-C',
  '-c',
  '-m',
  '-p',
  '--ask-for-approval',
  '--cd',
  '--config',
  '--model',
  '--profile',
  '--sandbox',
])

export function shouldBypassHud(args: string[]): boolean {
  if (args.some(argument => argument === '--version' || argument === '-V' || argument === '--help' || argument === '-h')) {
    return true
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--') {
      return false
    }
    if (OPTIONS_WITH_VALUES.has(argument)) {
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      continue
    }
    return NON_INTERACTIVE_COMMANDS.has(argument)
  }
  return false
}
