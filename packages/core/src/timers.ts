export type TimerId = unknown

type TimerGlobals = {
  setTimeout?: (callback: () => void, delayMs: number) => TimerId
  clearTimeout?: (id: TimerId) => void
}

function timers(): TimerGlobals {
  return globalThis as TimerGlobals
}

export function schedule(callback: () => void, delayMs: number): TimerId | null {
  const start = timers().setTimeout
  if (!start) {
    return null
  }
  const id = start(callback, delayMs)
  ;(id as { unref?: () => void })?.unref?.()
  return id
}

export function cancel(id: TimerId | null): void {
  if (id === null || id === undefined) {
    return
  }
  timers().clearTimeout?.(id)
}

export function sleepFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (schedule(resolve, delayMs) === null) {
      resolve()
    }
  })
}
