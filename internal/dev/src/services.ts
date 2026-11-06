import { connect } from 'node:net'

export type Service = {
  name: string
  host: string
  port: number
  hint: string
}

export const DEV_SERVICES: readonly Service[] = [
  { name: 'Postgres', host: '127.0.0.1', port: 5432, hint: 'accounts, projects and keys' },
  { name: 'ClickHouse', host: '127.0.0.1', port: 8123, hint: 'the logs themselves' },
  { name: 'Valkey', host: '127.0.0.1', port: 6379, hint: 'sessions and sign-in codes' },
  { name: 'Mailpit', host: '127.0.0.1', port: 1025, hint: 'every e-mail this stack sends' },
]

export function answers(service: Service, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: service.host, port: service.port })
    const done = (reached: boolean): void => {
      socket.destroy()
      resolve(reached)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

export async function waitFor(
  services: ReadonlyArray<Service>,
  options: {
    attempts?: number
    everyMs?: number
    timeoutMs?: number
    sleep?: (ms: number) => Promise<void>
    reach?: (service: Service, timeoutMs: number) => Promise<boolean>
  } = {},
): Promise<Service[]> {
  const attempts = options.attempts ?? 30
  const everyMs = options.everyMs ?? 1000
  const timeoutMs = options.timeoutMs ?? 2000
  const reach = options.reach ?? answers
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  let missing = [...services]
  for (let attempt = 0; attempt < attempts && missing.length > 0; attempt += 1) {
    if (attempt > 0) {
      await sleep(everyMs)
    }
    const reached = await Promise.all(missing.map((service) => reach(service, timeoutMs)))
    missing = missing.filter((_, index) => reached[index] !== true)
  }
  return missing
}
