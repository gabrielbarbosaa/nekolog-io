export const DEFAULT_MAX_QUEUE_EVENTS = 1000

export type BoundedQueue<T> = {
  readonly size: number
  readonly dropped: number
  push(item: T): number
  prepend(items: T[]): number
  take(count: number): T[]
  drain(): T[]
  clear(): void
}

export function boundedQueue<T>(limit: number = DEFAULT_MAX_QUEUE_EVENTS): BoundedQueue<T> {
  const capacity = Math.max(1, Math.trunc(limit))
  let items: T[] = []
  let dropped = 0

  const trim = (): number => {
    if (items.length <= capacity) {
      return 0
    }
    const excess = items.length - capacity
    items = items.slice(excess)
    dropped += excess
    return excess
  }

  return {
    get size() {
      return items.length
    },
    get dropped() {
      return dropped
    },
    push(item) {
      items.push(item)
      return trim()
    },
    prepend(incoming) {
      items = [...incoming, ...items]
      return trim()
    },
    take(count) {
      return items.splice(0, Math.max(0, Math.trunc(count)))
    },
    drain() {
      const all = items
      items = []
      return all
    },
    clear() {
      items = []
    },
  }
}
