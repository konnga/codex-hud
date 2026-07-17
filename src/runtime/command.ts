export function resolveHubCommand(args: string[]): string {
  return args[0] ?? 'start'
}
