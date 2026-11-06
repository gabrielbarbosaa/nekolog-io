import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { answers, DEV_SERVICES, type Service, waitFor } from './services.ts'

const PORT = 4571

function service(overrides: Partial<Service> = {}): Service {
  return { name: 'Something', host: '127.0.0.1', port: PORT, hint: 'a test', ...overrides }
}

describe('the services this stack needs', () => {
  it('names the four containers, each with what it is for', () => {
    expect(DEV_SERVICES.map((one) => one.name)).toEqual([
      'Postgres',
      'ClickHouse',
      'Valkey',
      'Mailpit',
    ])
    expect(DEV_SERVICES.every((one) => one.hint !== '')).toBe(true)
  })

  it('reaches a port that is open and not one that is closed', async () => {
    const server = createServer()
    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    try {
      expect(await answers(service(), 2000)).toBe(true)
      expect(await answers(service({ port: PORT + 1 }), 500)).toBe(false)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('waiting for a container that is still starting', () => {
  it('gives up only after the attempts run out, and names what is missing', async () => {
    let tries = 0
    const missing = await waitFor([service(), service({ name: 'Other', port: PORT + 1 })], {
      attempts: 3,
      sleep: async () => {},
      reach: async (one) => {
        tries += 1
        return one.name === 'Something'
      },
    })

    expect(missing.map((one) => one.name)).toEqual(['Other'])
    expect(tries, 'it stops asking the one that already answered').toBe(4)
  })

  it('stops the moment everything answers', async () => {
    let tries = 0
    const missing = await waitFor([service()], {
      attempts: 5,
      sleep: async () => {},
      reach: async () => {
        tries += 1
        return true
      },
    })

    expect(missing).toEqual([])
    expect(tries).toBe(1)
  })

  it('comes back happy when it is given nothing to wait for', async () => {
    expect(await waitFor([], { sleep: async () => {} })).toEqual([])
  })
})
