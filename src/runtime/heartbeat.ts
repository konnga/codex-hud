export interface HeartbeatScheduler {
  reschedule: (intervalMs: number) => void
  stop: () => void
}

export function createHeartbeatScheduler(callback: () => void): HeartbeatScheduler {
  let timer: NodeJS.Timeout | null = null
  return {
    reschedule(intervalMs): void {
      if (timer) {
        clearInterval(timer)
      }
      timer = setInterval(callback, intervalMs)
    },
    stop(): void {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
