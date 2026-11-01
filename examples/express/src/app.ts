import { randomBytes } from 'node:crypto'
import { addContext, type Logger } from '@nekolog-io/node'
import express, { type Express } from 'express'
import { httpError } from './errors.ts'
import {
  type MiddlewareOptions,
  withAccessLog,
  withErrorLog,
  withLogContext,
} from './middleware.ts'
import { assertOrderId, parseOrder } from './orders.ts'

export const MAX_BODY_BYTES = 16 * 1024

export type AppOptions = MiddlewareOptions & {
  logger: Logger
  newOrderId?: () => string
}

export function createApp(options: AppOptions): Express {
  const { logger } = options
  const newOrderId = options.newOrderId ?? (() => `ord_${randomBytes(4).toString('hex')}`)
  const app = express()

  app.disable('x-powered-by')

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.use(withLogContext(options))
  app.use(withAccessLog(logger, options))
  app.use(express.json({ limit: MAX_BODY_BYTES }))

  app.get('/orders/:id', (request, response) => {
    const id = assertOrderId(request.params.id)

    addContext({ attributes: { 'order.id': id } })
    logger.info('Order looked up')

    response.json({ id, status: 'paid', totalCents: 4990 })
  })

  app.post('/orders', (request, response) => {
    const order = parseOrder(request.body)
    const id = newOrderId()

    addContext({ session: { userId: order.customerId }, attributes: { 'order.id': id } })
    logger.info('Order created', {
      order: { totalCents: order.totalCents },
      customer: { email: order.email },
    })

    response.status(201).json({ id })
  })

  app.get('/boom', () => {
    throw new Error('the payment gateway at 10.0.3.14 timed out')
  })

  app.use((_request, _response) => {
    throw httpError(404, 'No such endpoint')
  })

  app.use(withErrorLog(logger))

  return app
}
