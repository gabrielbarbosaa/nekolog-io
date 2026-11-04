export const DEFAULT_CORPUS_EVENTS = 200
export const DEFAULT_SERVICE = 'checkout-api'
export const DEFAULT_RELEASE = '1.4.2'
export const ERROR_EVERY_NTH = 5

export const CORPUS_STACK: string = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at resolveOrder (/srv/app/dist/orders.js:118:31)',
  '    at async handler (/srv/app/dist/routes.js:42:12)',
  '    at async run (/srv/app/dist/server.js:203:5)',
  '    at async /srv/app/node_modules/express/lib/router/index.js:280:7',
].join('\n')

export type CorpusOptions = {
  events?: number
  errorEveryNth?: number
  distinctErrors?: boolean
  service?: string
  release?: string
  batchId?: string
  at?: number
}

export type CorpusBatch = {
  schemaVersion: number
  batchId: string
  sdk: { name: string; version: string }
  resource: { service: string; runtime: string; release: string }
  events: Array<Record<string, unknown>>
}

function hex(at: number, width: number): string {
  return at.toString(16).padStart(width, '0').slice(-width)
}

export function corpusBatchId(seed: number): string {
  const stamp = hex(seed, 12)
  return `${stamp.slice(0, 8)}-${stamp.slice(8, 12)}-7${hex(seed, 3)}-9${hex(seed + 1, 3)}-${hex(seed + 2, 12)}`
}

export function logBatch(options: CorpusOptions = {}): CorpusBatch {
  const events = options.events ?? DEFAULT_CORPUS_EVENTS
  const everyNth = options.errorEveryNth ?? ERROR_EVERY_NTH
  const at = options.at ?? Date.UTC(2026, 10, 4, 12, 0, 0)

  return {
    schemaVersion: 1,
    batchId: options.batchId ?? corpusBatchId(1),
    sdk: { name: '@nekolog-io/node', version: '1.0.0' },
    resource: {
      service: options.service ?? DEFAULT_SERVICE,
      runtime: 'node',
      release: options.release ?? DEFAULT_RELEASE,
    },
    events: Array.from({ length: events }, (_, index) => {
      const failing = everyNth > 0 && index % everyNth === 0
      const stack = options.distinctErrors
        ? CORPUS_STACK.replace('orders.js', `orders-${index}.js`)
        : CORPUS_STACK

      return {
        timestamp: new Date(at + index).toISOString(),
        level: failing ? 'error' : 'info',
        message: failing
          ? 'order resolution failed for customer ana.lima@example.com'
          : `GET /orders/ord_${index} 200 in 41 ms`,
        trace: { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7' },
        session: { id: 'ses_01933b9e7c1a', userId: 'usr_8812' },
        attributes: {
          'http.method': 'GET',
          'http.route': '/orders/:id',
          'http.status_code': 200,
          orderId: `ord_${index}`,
          amount: 149.9,
          retried: false,
        },
        ...(failing ? { error: { type: 'TypeError', message: 'cannot read id', stack } } : {}),
      }
    }),
  }
}

export function batchBytes(batch: CorpusBatch): number {
  return new TextEncoder().encode(JSON.stringify(batch)).byteLength
}
