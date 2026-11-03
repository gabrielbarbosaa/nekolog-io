import type { Logger } from '@nekolog-io/core'
import {
  accessAttributes,
  accessMessage,
  levelForStatus,
  REQUEST_ID_HEADER,
  runWithContext,
  startRequest,
  TRACEPARENT_HEADER,
  UNMATCHED_ROUTE,
} from '@nekolog-io/node'

export type HonoContext = {
  req: {
    method: string
    path?: string
    routePath?: string
    header(name: string): string | undefined
  }
  res: { status: number }
  header(name: string, value: string): unknown
}

export type HonoNext = () => Promise<void>

export type HonoMiddleware = (context: HonoContext, next: HonoNext) => Promise<void>

export type MiddlewareOptions = {
  newRequestId?: () => string
  random?: () => number
  now?: () => number
  accessLog?: boolean
}

export function routeOf(context: HonoContext): string {
  const route = context.req.routePath
  if (typeof route === 'string' && route !== '' && route !== '/*') {
    return route
  }
  return typeof context.req.path === 'string' ? context.req.path : UNMATCHED_ROUTE
}

function header(context: HonoContext, name: string): string | undefined {
  try {
    return context.req.header(name)
  } catch {
    return undefined
  }
}

export function nekolog(logger: Logger, options: MiddlewareOptions = {}): HonoMiddleware {
  const now = options.now ?? Date.now

  return async (context, next) => {
    const started = startRequest({
      traceparent: header(context, TRACEPARENT_HEADER),
      requestId: header(context, REQUEST_ID_HEADER),
      newRequestId: options.newRequestId,
      random: options.random,
    })

    for (const [name, value] of Object.entries(started.headers)) {
      context.header(name, value)
    }

    const startedAt = now()

    const record = (): void => {
      if (options.accessLog === false) {
        return
      }
      const line = {
        method: context.req.method,
        route: routeOf(context),
        status: context.res.status,
        durationMs: now() - startedAt,
      }
      try {
        logger.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))
      } catch {
        return
      }
    }

    await runWithContext(started.context, async () => {
      try {
        await next()
      } finally {
        record()
      }
    })
  }
}
