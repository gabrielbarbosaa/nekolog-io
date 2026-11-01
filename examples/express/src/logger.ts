import { createLogger, type Logger, type NodeLoggerOptions } from '@nekolog-io/node'

export const DEFAULT_SERVICE = 'example-express'
export const FLUSH_INTERVAL_ENV = 'NEKOLOG_FLUSH_INTERVAL_MS'
export const SENSITIVE_KEYS: readonly string[] = ['email', 'phone', 'address']

export function flushIntervalFrom(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined
  }
  const milliseconds = Number(value)
  if (!Number.isInteger(milliseconds) || milliseconds < 0) {
    throw new Error(
      `${FLUSH_INTERVAL_ENV} precisa ser um número inteiro de milissegundos, veio ${JSON.stringify(value)}`,
    )
  }
  return milliseconds
}

export function createExampleLogger(options: NodeLoggerOptions = {}): Logger {
  const flushIntervalMs = flushIntervalFrom(process.env[FLUSH_INTERVAL_ENV])

  return createLogger({
    ...options,
    service: options.service ?? process.env.NEKOLOG_SERVICE ?? DEFAULT_SERVICE,
    privacy: {
      ...options.privacy,
      extraKeys: [...SENSITIVE_KEYS, ...(options.privacy?.extraKeys ?? [])],
    },
    transport: {
      ...options.transport,
      ...(flushIntervalMs === undefined ? {} : { flushIntervalMs }),
    },
  })
}
