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

export type FastifyRequest = {
  method: string
  headers: Record<string, unknown>
  routeOptions?: { url?: unknown }
  routerPath?: unknown
}

export type FastifyReply = {
  statusCode: number
  header(name: string, value: string): unknown
  elapsedTime?: number
}

export type FastifyHook = (...args: never[]) => unknown

export type FastifyLike = {
  addHook(name: string, handler: FastifyHook): unknown
}

export type PluginOptions = {
  logger: Logger
  newRequestId?: () => string
  random?: () => number
  now?: () => number
  accessLog?: boolean
}

export function routeOf(request: FastifyRequest): string {
  const url = request.routeOptions?.url ?? request.routerPath
  return typeof url === 'string' && url !== '' ? url : UNMATCHED_ROUTE
}

export function headerOf(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers?.[name]
  if (typeof value === 'string') {
    return value
  }
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

export const SKIP_OVERRIDE: symbol = Symbol.for('skip-override')

export function nekologPlugin(
  instance: FastifyLike,
  options: PluginOptions,
  done?: (error?: unknown) => void,
): void {
  const { logger } = options
  const now = options.now ?? Date.now
  const started = new WeakMap<object, number>()

  const onRequest = (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: unknown) => void,
  ): void => {
    const begun = startRequest({
      traceparent: headerOf(request, TRACEPARENT_HEADER),
      requestId: headerOf(request, REQUEST_ID_HEADER),
      newRequestId: options.newRequestId,
      random: options.random,
    })

    for (const [name, value] of Object.entries(begun.headers)) {
      reply.header(name, value)
    }
    started.set(request as object, now())

    runWithContext(begun.context, () => done())
  }

  const onResponse = (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (error?: unknown) => void,
  ): void => {
    if (options.accessLog !== false) {
      const begunAt = started.get(request as object)
      const line = {
        method: request.method,
        route: routeOf(request),
        status: reply.statusCode,
        durationMs: begunAt === undefined ? (reply.elapsedTime ?? 0) : now() - begunAt,
      }
      try {
        logger.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))
      } catch {
        done()
        return
      }
    }
    done()
  }

  const onError = (
    _request: FastifyRequest,
    reply: FastifyReply,
    error: unknown,
    done: (error?: unknown) => void,
  ): void => {
    try {
      logger.log(levelForStatus(reply.statusCode), error)
    } catch {
      done()
      return
    }
    done()
  }

  instance.addHook('onRequest', onRequest as unknown as FastifyHook)
  instance.addHook('onResponse', onResponse as unknown as FastifyHook)
  instance.addHook('onError', onError as unknown as FastifyHook)

  done?.()
}

Object.defineProperty(nekologPlugin, SKIP_OVERRIDE, { value: true })
