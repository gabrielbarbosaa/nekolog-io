import type { BlobStore, LogStore } from '@internal/adapters'
import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'
import { type SpoolResendEvent, spoolResendTask } from './tasks/spool-resend.ts'

export type TaskDeps = {
  spool: BlobStore
  logStore: LogStore
  onSpoolEvent?: (event: SpoolResendEvent) => void
}

export function buildTasks(deps: TaskDeps): readonly Task[] {
  return registerTasks([
    spoolResendTask({
      spool: deps.spool,
      logStore: deps.logStore,
      ...(deps.onSpoolEvent === undefined ? {} : { onEvent: deps.onSpoolEvent }),
    }),
  ])
}
