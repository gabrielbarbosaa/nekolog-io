import type { Logger } from '@nekolog-io/core'
import {
  accessAttributes,
  accessMessage,
  bindContext,
  currentContext,
  levelForStatus,
  REQUEST_ID_HEADER,
  runWithContext,
  startRequest,
  TRACEPARENT_HEADER,
  UNMATCHED_ROUTE,
} from '@nekolog-io/node'

export type ExpressRequest = {
  method: string
  baseUrl?: string
  route?: { path?: unknown }
  get(name: string): string | undefined
}

export type ExpressResponse = {
  statusCode: number
  headersSent?: boolean
  setHeader(name: string, value: string): unknown
  on(event: string, listener: () => void): unknown
}

export type ExpressNext = (error?: unknown) => void

export type ExpressHandler = (
  request: ExpressRequest,
  response: ExpressResponse,
  next: ExpressNext,
) => void

export type ExpressErrorHandler = (
  error: unknown,
  request: ExpressRequest,
  response: ExpressResponse,
  next: ExpressNext,
) => void

export type MiddlewareOptions = {
  newRequestId?: () => string
  random?: () => number
  now?: () => number
}

export function routeOf(request: ExpressRequest): string {
  const path = request.route?.path
  return typeof path === 'string' ? `${request.baseUrl ?? ''}${path}` : UNMATCHED_ROUTE
}

function header(request: ExpressRequest, name: string): string | undefined {
  try {
    return request.get(name)
  } catch {
    return undefined
  }
}

export function withLogContext(options: MiddlewareOptions = {}): ExpressHandler {
  return (request, response, next) => {
    const started = startRequest({
      traceparent: header(request, TRACEPARENT_HEADER),
      requestId: header(request, REQUEST_ID_HEADER),
      newRequestId: options.newRequestId,
      random: options.random,
    })

    for (const [name, value] of Object.entries(started.headers)) {
      response.setHeader(name, value)
    }

    runWithContext(started.context, next)
  }
}

export function withAccessLog(logger: Logger, options: MiddlewareOptions = {}): ExpressHandler {
  const now = options.now ?? Date.now

  return (request, response, next) => {
    const startedAt = now()
    const context = currentContext()

    const emit = (): void => {
      const line = {
        method: request.method,
        route: routeOf(request),
        status: response.statusCode,
        durationMs: now() - startedAt,
      }
      logger.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))
    }

    response.on('finish', context === undefined ? emit : bindContext(context, emit))
    next()
  }
}

export type ErrorLogOptions = {
  statusOf?: (error: unknown) => number
}

export function statusOfError(error: unknown): number {
  const candidate = (error as { status?: unknown; statusCode?: unknown } | null)?.status
  const fallback = (error as { statusCode?: unknown } | null)?.statusCode
  for (const value of [candidate, fallback]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599) {
      return value
    }
  }
  return 500
}

export function withErrorLog(logger: Logger, options: ErrorLogOptions = {}): ExpressErrorHandler {
  const statusOf = options.statusOf ?? statusOfError

  return (error, _request, _response, next) => {
    try {
      logger.log(levelForStatus(statusOf(error)), error)
    } catch {
      next(error)
      return
    }
    next(error)
  }
}
