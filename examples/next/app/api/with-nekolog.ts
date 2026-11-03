import {
  accessAttributes,
  accessMessage,
  levelForStatus,
  REQUEST_ID_HEADER,
  runWithContext,
  serverLogger,
  startRequest,
  TRACEPARENT_HEADER,
} from '@nekolog-io/next'

export type RouteHandler = (request: Request) => Promise<Response>

export function withNekolog(route: string, handler: RouteHandler): RouteHandler {
  return async (request) => {
    const began = startRequest({
      traceparent: request.headers.get(TRACEPARENT_HEADER),
      requestId: request.headers.get(REQUEST_ID_HEADER),
    })
    const startedAt = Date.now()

    return runWithContext(began.context, async () => {
      const response = await handler(request)

      for (const [name, value] of Object.entries(began.headers)) {
        response.headers.set(name, value)
      }

      const line = {
        method: request.method,
        route,
        status: response.status,
        durationMs: Date.now() - startedAt,
      }
      serverLogger()?.log(levelForStatus(line.status), accessMessage(line), accessAttributes(line))

      return response
    })
  }
}
