import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { id } from './ids.ts'

export const DEMO_ORGANIZATION = 'NekoLog Demo'
export const DEMO_PROJECT = 'storefront'
export const DEMO_EMAIL = 'demo@nekolog.io'
export const DEMO_ENVIRONMENTS = ['production', 'staging'] as const
export const DEMO_RETENTION_DAYS = 7

export const DEMO_SERVICES = ['storefront-web', 'checkout-api', 'orders-worker', 'search-api']

export type Statement = { text: string; params: unknown[] }

export type DemoPlan = {
  organizationId: string
  userId: string
  projectId: string
  environments: Array<{ id: string; name: string }>
  statements: Statement[]
}

const NEVER_SIGNS_IN = '$argon2id$v=19$m=19456,t=2,p=1$ZGVtbw$' + 'x'.repeat(43)

export function planDemo(at: number = Date.now()): DemoPlan {
  const organizationId = id('org_', at)
  const userId = id('usr_', at)
  const projectId = id('prj_', at)
  const environments = DEMO_ENVIRONMENTS.map((name) => ({ id: id('env_', at), name }))

  const statements: Statement[] = [
    {
      text: `insert into organizations (id, name, is_demo, max_retention_days)
             values ($1, $2, true, $3)
             on conflict (id) do nothing`,
      params: [organizationId, DEMO_ORGANIZATION, DEMO_RETENTION_DAYS],
    },
    {
      text: `insert into users (id, name, email, password_hash, email_verified_at, is_demo)
             values ($1, 'Demo', $2, $3, now(), true)
             on conflict (email) do update set is_demo = true`,
      params: [userId, DEMO_EMAIL, NEVER_SIGNS_IN],
    },
    {
      text: `insert into memberships (id, organization_id, user_id, role)
             select $1, $2, users.id, 'viewer' from users where users.email = $3
             on conflict (organization_id, user_id) do update set role = 'viewer'`,
      params: [id('mem_', at), organizationId, DEMO_EMAIL],
    },
    {
      text: `insert into projects (id, organization_id, name)
             values ($1, $2, $3) on conflict (id) do nothing`,
      params: [projectId, organizationId, DEMO_PROJECT],
    },
  ]

  for (const environment of environments) {
    statements.push({
      text: `insert into environments (id, project_id, name, color, retention_days)
             values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
      params: [
        environment.id,
        projectId,
        environment.name,
        environment.name === 'production' ? 'chart-8' : 'chart-4',
        DEMO_RETENTION_DAYS,
      ],
    })
  }

  return { organizationId, userId, projectId, environments, statements }
}

export const FORGET_THE_DEMO: readonly Statement[] = [
  {
    text: 'delete from memberships where user_id in (select id from users where is_demo)',
    params: [],
  },
  { text: 'delete from users where is_demo', params: [] },
  { text: 'delete from organizations where is_demo', params: [] },
]

type Shape = {
  level: string
  message: string
  service: string
  attributes: Record<string, string>
  errorType?: string
  stacktrace?: string
}

const ORDINARY: ReadonlyArray<(n: number) => Shape> = [
  (n) => ({
    level: 'info',
    message: `GET /products/${1000 + (n % 400)} 200 in ${8 + (n % 90)} ms`,
    service: 'storefront-web',
    attributes: {
      'http.method': 'GET',
      'http.route': '/products/:id',
      'http.status_code': '200',
      'http.duration_ms': String(8 + (n % 90)),
    },
  }),
  (n) => ({
    level: 'info',
    message: `order ord_${7000 + (n % 900)} placed`,
    service: 'checkout-api',
    attributes: {
      orderId: `ord_${7000 + (n % 900)}`,
      amount: `${(19 + (n % 240)).toFixed(2)}`,
      currency: 'BRL',
    },
  }),
  (n) => ({
    level: 'debug',
    message: `cache hit for search "${['tênis', 'camiseta', 'fone', 'mochila'][n % 4]}"`,
    service: 'search-api',
    attributes: { 'cache.hit': 'true', 'query.terms': String(1 + (n % 3)) },
  }),
  (n) => ({
    level: 'info',
    message: `job reindex finished, ${120 + (n % 800)} documents`,
    service: 'orders-worker',
    attributes: { 'job.name': 'reindex', 'job.documents': String(120 + (n % 800)) },
  }),
]

const TROUBLE: ReadonlyArray<(n: number) => Shape> = [
  (n) => ({
    level: 'warn',
    message: `payment gateway slow: ${1200 + (n % 2400)} ms`,
    service: 'checkout-api',
    attributes: { 'gateway.name': 'stripe', 'gateway.duration_ms': String(1200 + (n % 2400)) },
  }),
  (n) => ({
    level: 'error',
    message: 'cannot read properties of undefined (reading "total")',
    service: 'checkout-api',
    errorType: 'TypeError',
    stacktrace:
      'TypeError: cannot read properties of undefined (reading "total")\n' +
      '    at summarise (/app/src/cart.ts:118:24)\n' +
      '    at checkout (/app/src/checkout.ts:42:18)\n' +
      '    at async POST (/app/src/routes/orders.ts:31:5)',
    attributes: { orderId: `ord_${7000 + (n % 900)}`, 'http.status_code': '500' },
  }),
  () => ({
    level: 'error',
    message: 'upstream timed out after 5000 ms',
    service: 'search-api',
    errorType: 'TimeoutError',
    stacktrace:
      'TimeoutError: upstream timed out after 5000 ms\n' +
      '    at withDeadline (/app/src/http.ts:64:11)\n' +
      '    at search (/app/src/search.ts:22:20)',
    attributes: { 'upstream.name': 'catalog', 'upstream.timeout_ms': '5000' },
  }),
  () => ({
    level: 'fatal',
    message: 'the orders queue is unreachable, shutting down',
    service: 'orders-worker',
    errorType: 'ConnectionError',
    stacktrace:
      'ConnectionError: the orders queue is unreachable, shutting down\n' +
      '    at connect (/app/src/queue.ts:19:9)',
    attributes: { 'queue.name': 'orders', 'queue.host': 'queue.internal' },
  }),
]

export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '')
}

export type DemoLine = Record<string, unknown>

export function demoLines(options: {
  projectId: string
  environmentId: string
  count: number
  overMs: number
  until?: number
  troubleEvery?: number
}): DemoLine[] {
  const until = options.until ?? Date.now()
  const troubleEvery = options.troubleEvery ?? 11
  const step = options.overMs / Math.max(1, options.count)
  const lines: DemoLine[] = []

  for (let n = 0; n < options.count; n += 1) {
    const build =
      n % troubleEvery === 0
        ? (TROUBLE[Math.floor(n / troubleEvery) % TROUBLE.length] as (n: number) => Shape)
        : (ORDINARY[n % ORDINARY.length] as (n: number) => Shape)
    const shape = build(n)
    const at = stamp(Math.round(until - options.overMs + n * step))
    const trace = randomBytes(16).toString('hex')

    lines.push({
      project_id: options.projectId,
      environment_id: options.environmentId,
      timestamp: at,
      received_at: at,
      level: shape.level,
      message: shape.message,
      service: shape.service,
      release: '2026.11.3',
      source: shape.service === 'storefront-web' ? 'browser' : 'node',
      trace_id: trace,
      span_id: trace.slice(0, 16),
      session_id: shape.service === 'storefront-web' ? randomUUID() : '',
      user_id: `usr_demo_${n % 37}`,
      error_type: shape.errorType ?? '',
      stacktrace: shape.stacktrace ?? '',
      attributes: shape.attributes,
      country: ['BR', 'PT', 'US', 'ES'][n % 4] as string,
      retention_days: DEMO_RETENTION_DAYS,
    })
  }

  return lines
}

export function fingerprintOf(text: string): string {
  return BigInt(`0x${createHash('sha256').update(text).digest('hex').slice(0, 16)}`).toString()
}
