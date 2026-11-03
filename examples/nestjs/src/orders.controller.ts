import { addContext, type Logger, NEKOLOG_LOGGER } from '@nekolog-io/nestjs'
import { BadRequestException, Body, Controller, Get, Inject, Param, Post } from '@nestjs/common'

export const ORDER_ID_PATTERN = /^ord_[0-9a-z]{1,24}$/
export const CUSTOMER_ID_PATTERN = /^cus_[0-9a-z]{1,24}$/
export const MAX_TOTAL_CENTS = 1_000_000_00

export type NewOrder = {
  customerId: string
  email: string
  totalCents: number
}

function text(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`"${field}" is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxChars) {
    throw new BadRequestException(`"${field}" is longer than ${maxChars} characters`)
  }
  return trimmed
}

export function assertOrderId(value: unknown): string {
  const id = text(value, 'id', 28)
  if (!ORDER_ID_PATTERN.test(id)) {
    throw new BadRequestException('An order id looks like ord_7f3a91')
  }
  return id
}

export function parseOrder(body: unknown): NewOrder {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('The body must be a JSON object')
  }
  const candidate = body as Record<string, unknown>

  const customerId = text(candidate.customerId, 'customerId', 28)
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw new BadRequestException('A customer id looks like cus_7f3a91')
  }

  const totalCents = candidate.totalCents
  if (
    typeof totalCents !== 'number' ||
    !Number.isInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > MAX_TOTAL_CENTS
  ) {
    throw new BadRequestException('"totalCents" must be a whole number of cents above zero')
  }

  return { customerId, email: text(candidate.email, 'email', 254), totalCents }
}

@Controller()
export class OrdersController {
  constructor(@Inject(NEKOLOG_LOGGER) private readonly log: Logger) {}

  @Get('orders/:id')
  find(@Param('id') raw: string): { id: string; status: string } {
    const id = assertOrderId(raw)
    this.log.info('Order looked up', { 'order.id': id })
    return { id, status: 'paid' }
  }

  @Post('orders')
  create(@Body() body: unknown): { id: string } {
    const order = parseOrder(body)
    const id = `ord_${Date.now().toString(36)}`

    addContext({ session: { userId: order.customerId } })
    this.log.info('Order created', {
      'order.id': id,
      'customer.email': order.email,
      'order.totalCents': order.totalCents,
    })

    return { id }
  }

  @Get('boom')
  boom(): never {
    throw new Error('the orders database at 10.0.3.14 refused the connection')
  }
}
