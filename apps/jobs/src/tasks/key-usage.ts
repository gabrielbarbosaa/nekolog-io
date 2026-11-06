import type { KeyDirectory, KeyUsageStamp } from '@nekolog-io/adapters'
import type { Task, TaskContext } from '../task.ts'

export const KEY_USAGE_TASK = 'key-usage'

export const KEY_USAGE_WINDOW_MS: number = 15 * 60 * 1000

export type KeyUsageStop = 'finished' | 'usage_unavailable' | 'out_of_time'

export type KeyUsageReport = {
  seen: number
  stamped: number
  stopped: KeyUsageStop
}

export type KeyUsageReader = (
  since: Date,
  signal: AbortSignal,
) => Promise<ReadonlyArray<KeyUsageStamp>>

export type KeyUsageOptions = {
  directory: KeyDirectory
  read: KeyUsageReader
  windowMs?: number
}

export function keyUsageTask(options: KeyUsageOptions): Task {
  const windowMs = options.windowMs ?? KEY_USAGE_WINDOW_MS

  return {
    name: KEY_USAGE_TASK,
    everyMinutes: 5,

    async run(context: TaskContext): Promise<KeyUsageReport> {
      const result: KeyUsageReport = { seen: 0, stamped: 0, stopped: 'finished' }

      let seen: ReadonlyArray<KeyUsageStamp>
      try {
        seen = await options.read(new Date(context.scheduledAt - windowMs), context.signal)
      } catch {
        result.stopped = 'usage_unavailable'
        return result
      }

      const named = seen.filter((stamp) => stamp.keyId !== '')
      result.seen = named.length

      if (context.signal.aborted) {
        result.stopped = 'out_of_time'
        return result
      }

      result.stamped = await options.directory.stampLastUsed(named)
      return result
    },
  }
}
