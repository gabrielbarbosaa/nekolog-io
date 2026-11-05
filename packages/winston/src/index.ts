import type { AttributeInput, Logger, LogLevel } from '@nekolog-io/core'
import TransportStream from 'winston-transport'

export const SDK_NAME = '@nekolog-io/winston'
export const SDK_VERSION = '1.0.0'

export const LEVEL_SYMBOL: symbol = Symbol.for('level')
export const MESSAGE_SYMBOL: symbol = Symbol.for('message')
export const SPLAT_SYMBOL: symbol = Symbol.for('splat')

export const WINSTON_OWN_FIELDS: readonly string[] = ['level', 'message', 'stack']
export const MESSAGE_ATTRIBUTE = 'log.msg'

const NPM_LEVELS: Readonly<Record<string, LogLevel>> = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  http: 'debug',
  verbose: 'debug',
  debug: 'debug',
  silly: 'trace',
}

const SYSLOG_LEVELS: Readonly<Record<string, LogLevel>> = {
  emerg: 'fatal',
  alert: 'fatal',
  crit: 'fatal',
  error: 'error',
  warning: 'warn',
  notice: 'info',
  info: 'info',
  debug: 'debug',
}

export function levelOf(value: unknown): LogLevel {
  if (typeof value !== 'string') {
    return 'info'
  }
  const named = value.toLowerCase()
  return NPM_LEVELS[named] ?? SYSLOG_LEVELS[named] ?? 'info'
}

export type WinstonInfo = Record<string | symbol, unknown>

const ERROR_NAME = /^[A-Za-z_$][A-Za-z0-9_$.]*$/

export function errorOf(info: WinstonInfo): Error | undefined {
  const stack = info.stack
  if (typeof stack !== 'string' || stack === '') {
    return undefined
  }

  const head = (stack.split('\n')[0] ?? '').trim()
  const divider = head.indexOf(': ')
  const name = divider === -1 ? '' : head.slice(0, divider)
  const described = divider === -1 ? head : head.slice(divider + 2)

  const error = new Error(
    described !== '' ? described : typeof info.message === 'string' ? info.message : '',
  )
  error.stack = stack
  if (ERROR_NAME.test(name)) {
    error.name = name
  }
  return error
}

export function attributesOf(info: WinstonInfo, skip: readonly string[]): AttributeInput {
  const attributes: AttributeInput = {}
  for (const [key, value] of Object.entries(info)) {
    if (!skip.includes(key)) {
      attributes[key] = value
    }
  }
  return attributes
}

export type NekologTransportOptions = ConstructorParameters<typeof TransportStream>[0] & {
  logger: Logger
  skip?: readonly string[]
  onError?: (error: unknown) => void
}

export class NekologTransport extends TransportStream {
  private readonly logger: Logger
  private readonly skip: readonly string[]
  private readonly report: ((error: unknown) => void) | undefined

  constructor(options: NekologTransportOptions) {
    super(options)
    this.logger = options.logger
    this.skip = options.skip ?? WINSTON_OWN_FIELDS
    this.report = options.onError
  }

  override log(info: WinstonInfo, next: () => void): void {
    try {
      const level = levelOf(info[LEVEL_SYMBOL] ?? info.level)
      const error = errorOf(info)
      const message = typeof info.message === 'string' ? info.message : String(info.message ?? '')
      const attributes = attributesOf(info, this.skip)

      if (error === undefined) {
        this.logger.log(level, message, attributes)
      } else {
        if (message !== error.message) {
          attributes[MESSAGE_ATTRIBUTE] = message
        }
        this.logger.log(level, error, attributes)
      }
    } catch (failure) {
      this.report?.(failure)
    }
    next()
  }

  override async close(): Promise<void> {
    try {
      await this.logger.flush()
    } catch (failure) {
      this.report?.(failure)
    }
  }
}
