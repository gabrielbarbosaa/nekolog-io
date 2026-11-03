import { addContext, serverLogger } from '@nekolog-io/next'
import { withNekolog } from '../with-nekolog'

export const CUSTOMER_ID_PATTERN = /^cus_[0-9a-z]{1,24}$/

export type NewOrder = {
  customerId: string
  email: string
  totalCents: number
}

export function parseOrder(body: unknown): NewOrder | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'The body must be a JSON object'
  }
  const candidate = body as Record<string, unknown>

  const customerId = candidate.customerId
  if (typeof customerId !== 'string' || !CUSTOMER_ID_PATTERN.test(customerId)) {
    return 'A customer id looks like cus_7f3a91'
  }

  const email = candidate.email
  if (typeof email !== 'string' || email.trim() === '') {
    return '"email" is required'
  }

  const totalCents = candidate.totalCents
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) {
    return '"totalCents" must be a whole number of cents above zero'
  }

  return { customerId, email: email.trim(), totalCents }
}

export const POST = withNekolog('/api/orders', async (request) => {
  const log = serverLogger()
  const order = parseOrder(await request.json().catch(() => null))

  if (typeof order === 'string') {
    log?.warn('Order refused', { reason: order })
    return Response.json({ error: { message: order } }, { status: 400 })
  }

  const id = `ord_${Date.now().toString(36)}`

  addContext({ session: { userId: order.customerId } })
  log?.info('Order created', {
    'order.id': id,
    'customer.email': order.email,
    'order.totalCents': order.totalCents,
  })

  return Response.json({ id }, { status: 201 })
})
