import { describe, expect, it } from 'vitest'
import { createJobsApp } from './app.ts'

describe('createJobsApp', () => {
  it('answers /health with the version and how many tasks are registered', async () => {
    const app = createJobsApp({ taskCount: 3, version: '0.4.1' })

    const response = await app.request('http://jobs.test/health')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'jobs',
      version: '0.4.1',
      tasks: 3,
    })
  })

  it('says the version is unknown instead of inventing one', async () => {
    const response = await createJobsApp({ taskCount: 0 }).request('http://jobs.test/health')

    expect(await response.json()).toMatchObject({ version: 'unknown', tasks: 0 })
  })

  it.each([
    ['GET', '/run'],
    ['POST', '/run'],
    ['POST', '/v1/run'],
    ['POST', '/tasks/quotas'],
    ['GET', '/trigger'],
    ['POST', '/health'],
  ])('refuses %s %s: nothing over HTTP may start a task', async (method, path) => {
    const app = createJobsApp({ taskCount: 1 })

    const response = await app.request(`http://jobs.test${path}`, { method })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } })
  })
})
