import { assertTask, type Task } from './task.ts'

export const MINUTE_MS = 60_000

export function epochMinute(timestamp: number): number {
  return Math.floor(timestamp / MINUTE_MS)
}

export function isDue(task: Task, scheduledAt: number): boolean {
  const offset = task.offsetMinutes ?? 0
  return (epochMinute(scheduledAt) - offset) % task.everyMinutes === 0
}

export function registerTasks(tasks: readonly Task[]): readonly Task[] {
  const seen = new Set<string>()
  for (const task of tasks) {
    assertTask(task)
    if (seen.has(task.name)) {
      throw new Error(`Two tasks are registered under the same name: "${task.name}"`)
    }
    seen.add(task.name)
  }
  return Object.freeze([...tasks])
}

export function dueTasks(tasks: readonly Task[], scheduledAt: number): Task[] {
  return tasks.filter((task) => isDue(task, scheduledAt))
}
