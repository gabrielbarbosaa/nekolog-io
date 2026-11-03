import type { AttributeInput, Logger, LogLevel } from '@nekolog-io/core'
import type { LoggerService } from '@nestjs/common'

export const CONTEXT_ATTRIBUTE = 'nest.context'

export function describeTrace(trace: unknown): string | undefined {
  if (typeof trace !== 'string') {
    return undefined
  }
  const trimmed = trace.trim()
  return trimmed === '' ? undefined : trimmed
}

export class NekologLoggerService implements LoggerService {
  private readonly logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  private write(level: LogLevel, message: unknown, rest: unknown[]): void {
    const context = rest.length > 0 ? rest[rest.length - 1] : undefined
    const attributes: AttributeInput = {}
    if (typeof context === 'string' && context.trim() !== '') {
      attributes[CONTEXT_ATTRIBUTE] = context.trim()
    }
    const stack = describeTrace(rest.length > 1 ? rest[0] : undefined)
    if (stack !== undefined) {
      attributes.stack = stack
    }
    this.logger.log(level, message, attributes)
  }

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest)
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest)
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest)
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest)
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest)
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest)
  }
}
