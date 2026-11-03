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
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { Observable, type Subscription, tap } from 'rxjs'

export type HttpRequest = {
  method?: unknown
  baseUrl?: unknown
  route?: { path?: unknown }
  headers?: Record<string, unknown>
}

export type HttpResponse = {
  statusCode?: unknown
  setHeader?: (name: string, value: string) => unknown
}

export type InterceptorOptions = {
  accessLog?: boolean
  errorLog?: boolean
  newRequestId?: () => string
  random?: () => number
  now?: () => number
}

export function headerOf(request: HttpRequest, name: string): string | undefined {
  const value = request.headers?.[name]
  if (typeof value === 'string') {
    return value
  }
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined
}

export function routeOf(request: HttpRequest): string {
  const path = request.route?.path
  if (typeof path !== 'string') {
    return UNMATCHED_ROUTE
  }
  const base = typeof request.baseUrl === 'string' ? request.baseUrl : ''
  return `${base}${path}`
}

export function statusOf(response: HttpResponse): number {
  return typeof response.statusCode === 'number' ? response.statusCode : 500
}

function serverError(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
    ? value
    : undefined
}

export function statusOfError(error: unknown): number {
  const asked = (error as { getStatus?: unknown } | null)?.getStatus
  if (typeof asked === 'function') {
    try {
      const found = serverError((asked as () => unknown).call(error))
      if (found !== undefined) {
        return found
      }
    } catch {
      return 500
    }
  }
  return serverError((error as { status?: unknown } | null)?.status) ?? 500
}

export class NekologInterceptor implements NestInterceptor {
  private readonly logger: Logger
  private readonly options: InterceptorOptions

  constructor(logger: Logger, options: InterceptorOptions = {}) {
    this.logger = logger
    this.options = options
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const http = context.switchToHttp()
    const request = http.getRequest<HttpRequest>()
    const response = http.getResponse<HttpResponse>()

    const began = startRequest({
      traceparent: headerOf(request, TRACEPARENT_HEADER),
      requestId: headerOf(request, REQUEST_ID_HEADER),
      newRequestId: this.options.newRequestId,
      random: this.options.random,
    })

    for (const [name, value] of Object.entries(began.headers)) {
      response.setHeader?.(name, value)
    }

    const now = this.options.now ?? Date.now
    const startedAt = now()
    const { accessLog } = this.options
    const logger = this.logger

    const { errorLog } = this.options

    const record = (failed?: { error: unknown }): void => {
      const status = failed === undefined ? statusOf(response) : statusOfError(failed.error)
      const line = {
        method: typeof request.method === 'string' ? request.method : 'UNKNOWN',
        route: routeOf(request),
        status,
        durationMs: now() - startedAt,
      }
      const level = levelForStatus(status)

      try {
        if (failed !== undefined && errorLog !== false) {
          logger.log(level, failed.error, accessAttributes(line))
        }
        if (accessLog !== false) {
          logger.log(level, accessMessage(line), accessAttributes(line))
        }
      } catch {
        return
      }
    }

    return new Observable((subscriber) => {
      let subscription: Subscription | undefined

      runWithContext(began.context, () => {
        subscription = next
          .handle()
          .pipe(
            tap({
              complete: () => record(),
              error: (error: unknown) => record({ error }),
            }),
          )
          .subscribe(subscriber)
      })

      return () => subscription?.unsubscribe()
    })
  }
}
