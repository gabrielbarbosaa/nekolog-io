import { registerTasks } from './schedule.ts'
import type { Task } from './task.ts'

export const SCHEDULED_TASKS: readonly Task[] = registerTasks([])
