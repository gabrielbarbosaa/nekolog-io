import type { KeyDirectory, KvNamespace } from '@nekolog-io/adapters'
import { publishKeys } from '@nekolog-io/adapters'
import type { Task, TaskContext } from '../task.ts'

export const KEY_SYNC_TASK = 'key-sync'

export type KeySyncStop = 'finished' | 'directory_unavailable' | 'out_of_time'

export type KeySyncReport = {
  live: number
  written: number
  removed: number
  unchanged: number
  stopped: KeySyncStop
}

export type KeySyncEvent = {
  kind: 'published' | 'unreadable'
  live: number
  written: number
  removed: number
}

export type KeySyncOptions = {
  directory: KeyDirectory
  kv: KvNamespace
  onEvent?: (event: KeySyncEvent) => void
}

export function keySyncTask(options: KeySyncOptions): Task {
  const report = (event: KeySyncEvent): void => {
    try {
      options.onEvent?.(event)
    } catch {
      return
    }
  }

  return {
    name: KEY_SYNC_TASK,
    everyMinutes: 1,

    async run(context: TaskContext): Promise<KeySyncReport> {
      const result: KeySyncReport = {
        live: 0,
        written: 0,
        removed: 0,
        unchanged: 0,
        stopped: 'finished',
      }

      let live: Awaited<ReturnType<KeyDirectory['live']>>
      try {
        live = await options.directory.live()
      } catch {
        result.stopped = 'directory_unavailable'
        report({ kind: 'unreadable', live: 0, written: 0, removed: 0 })
        return result
      }

      result.live = live.length

      if (context.signal.aborted) {
        result.stopped = 'out_of_time'
        return result
      }

      const published = await publishKeys(options.kv, live)
      result.written = published.written
      result.removed = published.removed
      result.unchanged = published.unchanged

      if (published.written > 0 || published.removed > 0) {
        report({
          kind: 'published',
          live: live.length,
          written: published.written,
          removed: published.removed,
        })
      }

      return result
    },
  }
}
