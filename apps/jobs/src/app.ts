import { Hono } from 'hono'

export type JobsAppDeps = {
  taskCount: number
  version?: string
}

export function createJobsApp(deps: JobsAppDeps): Hono {
  const app = new Hono()

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'jobs',
      version: deps.version ?? 'unknown',
      tasks: deps.taskCount,
    }),
  )

  app.all('*', (c) => c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404))

  return app
}
