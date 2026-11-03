import {
  type ExpressErrorHandler,
  withErrorLog as logTheError,
  statusOfError,
} from '@nekolog-io/express'
import type { Logger } from '@nekolog-io/node'
import type { ErrorRequestHandler } from 'express'
import { publicMessageOf, statusOf } from './errors.ts'

export type { MiddlewareOptions } from '@nekolog-io/express'
export { routeOf, withAccessLog, withLogContext } from '@nekolog-io/express'
export {
  levelForStatus,
  MAX_REQUEST_ID_CHARS,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from '@nekolog-io/node'

export function withErrorLog(logger: Logger): ErrorRequestHandler {
  const log = logTheError(logger, { statusOf }) as ExpressErrorHandler

  return (error, request, response, next) => {
    log(error, request as never, response as never, () => undefined)

    if (response.headersSent) {
      next(error)
      return
    }
    const status = statusOf(error) || statusOfError(error)
    response.status(status).json({ error: { message: publicMessageOf(error, status) } })
  }
}
