export type TaskContext = {
  scheduledAt: number
  cron: string
  signal: AbortSignal
}

export type Task = {
  name: string
  everyMinutes: number
  offsetMinutes?: number
  timeoutMs?: number
  run: (context: TaskContext) => unknown
}

export const DEFAULT_TASK_TIMEOUT_MS = 25_000

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/

export function assertTask(task: Task): Task {
  if (!NAME_PATTERN.test(task.name)) {
    throw new Error(`Task name must match ${NAME_PATTERN.source}, got "${task.name}"`)
  }
  if (!Number.isInteger(task.everyMinutes) || task.everyMinutes < 1) {
    throw new Error(`Task "${task.name}" needs everyMinutes as an integer of at least 1`)
  }
  const offset = task.offsetMinutes ?? 0
  if (!Number.isInteger(offset) || offset < 0 || offset >= task.everyMinutes) {
    throw new Error(
      `Task "${task.name}" needs offsetMinutes between 0 and ${task.everyMinutes - 1}, got ${offset}`,
    )
  }
  const timeout = task.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(`Task "${task.name}" needs a positive timeoutMs, got ${timeout}`)
  }
  return task
}
