import { randomUUID } from 'node:crypto'
import {
  bindContext,
  currentContext,
  type LogContext,
  type Logger,
  type LogLevel,
  runWithContext,
} from '@nekolog-io/node'
import type { ErrorRequestHandler, Request, RequestHandler } from 'express'
import { publicMessageOf, statusOf } from './errors.ts'
import { type RandomBytes, traceForRequest, traceparentOf } from './trace.ts'

export const REQUEST_ID_HEADER = 'x-request-id'
export const TRACEPARENT_HEADER = 'traceparent'
export const MAX_REQUEST_ID_CHARS = 64

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]+$/

export type MiddlewareOptions = {
  random?: RandomBytes
  newRequestId?: () => string
  now?: () => number
}

export function requestIdFrom(header: unknown, fallback: () => string): string {
  if (typeof header !== 'string') {
    return fallback()
  }
  const trimmed = header.trim()
  if (trimmed === '' || trimmed.length > MAX_REQUEST_ID_CHARS || !SAFE_REQUEST_ID.test(trimmed)) {
    return fallback()
  }
  return trimmed
}

export function levelForStatus(status: number): LogLevel {
  if (status >= 500) {
    return 'error'
  }
  return status >= 400 ? 'warn' : 'info'
}

export function routeOf(request: Request): string {
  const path = (request.route as { path?: unknown } | undefined)?.path
  return typeof path === 'string' ? `${request.baseUrl}${path}` : 'unmatched'
}

export function withLogContext(options: MiddlewareOptions = {}): RequestHandler {
  const newRequestId = options.newRequestId ?? randomUUID
  return (request, response, next) => {
    const { trace, parentSpanId, sampled } = traceForRequest(
      request.get(TRACEPARENT_HEADER),
      options.random,
    )
    const requestId = requestIdFrom(request.get(REQUEST_ID_HEADER), newRequestId)

    response.setHeader(TRACEPARENT_HEADER, traceparentOf(trace, sampled))
    response.setHeader(REQUEST_ID_HEADER, requestId)

    const context: LogContext = {
      trace,
      attributes: {
        'request.id': requestId,
        ...(parentSpanId === undefined ? {} : { 'trace.parentSpanId': parentSpanId }),
      },
    }

    runWithContext(context, next)
  }
}

export function withAccessLog(logger: Logger, options: MiddlewareOptions = {}): RequestHandler {
  const now = options.now ?? Date.now
  return (request, response, next) => {
    const startedAt = now()
    const context = currentContext()

    const emit = (): void => {
      const route = routeOf(request)
      logger.log(
        levelForStatus(response.statusCode),
        `${request.method} ${route} ${response.statusCode}`,
        {
          'http.method': request.method,
          'http.route': route,
          'http.status': response.statusCode,
          'http.durationMs': now() - startedAt,
        },
      )
    }

    response.on('finish', context === undefined ? emit : bindContext(context, emit))
    next()
  }
}

export function withErrorLog(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, next) => {
    const status = statusOf(error)
    logger.log(levelForStatus(status), error)

    if (response.headersSent) {
      next(error)
      return
    }
    response.status(status).json({ error: { message: publicMessageOf(error, status) } })
  }
}
