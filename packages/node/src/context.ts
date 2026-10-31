import { AsyncLocalStorage } from 'node:async_hooks'
import { type LogContext, mergeContexts } from '@nekolog-io/core'

const storage = new AsyncLocalStorage<LogContext>()

export function currentContext(): LogContext | undefined {
  return storage.getStore()
}

export function runWithContext<T>(context: LogContext, run: () => T): T {
  return storage.run(mergeContexts(storage.getStore() ?? {}, context), run)
}

export function bindContext<Args extends unknown[], Result>(
  context: LogContext,
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  return (...args) => runWithContext(context, () => fn(...args))
}

export function addContext(extra: LogContext): boolean {
  const store = storage.getStore()
  if (store === undefined) {
    return false
  }
  Object.assign(store, mergeContexts(store, extra))
  return true
}
