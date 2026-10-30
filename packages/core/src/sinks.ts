import type { LogEvent, LogLevel, Sink } from './types.ts'

export type ConsoleLike = Partial<
  Record<'debug' | 'info' | 'warn' | 'error' | 'log', (...args: unknown[]) => void>
>

export function globalConsole(): ConsoleLike | undefined {
  return (globalThis as { console?: ConsoleLike }).console
}

export function nullSink(): Sink {
  return {
    emit() {
      return
    },
  }
}

export function memorySink(): Sink & { events: LogEvent[] } {
  const events: LogEvent[] = []
  return {
    events,
    emit(event) {
      events.push(event)
    },
  }
}

const CONSOLE_METHOD: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
}

export function consoleSink(target: ConsoleLike | undefined = globalConsole()): Sink {
  return {
    emit(event) {
      if (!target) {
        return
      }
      const write = target[CONSOLE_METHOD[event.level]] ?? target.log
      if (!write) {
        return
      }
      const prefix = `[nekolog] ${event.level} ${event.message}`
      if (event.error?.stack) {
        write(prefix, event.attributes ?? {}, event.error.stack)
        return
      }
      write(prefix, event.attributes ?? {})
    },
  }
}
