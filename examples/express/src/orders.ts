import { httpError } from './errors.ts'

export const ORDER_ID_PATTERN = /^ord_[0-9a-z]{1,24}$/
export const CUSTOMER_ID_PATTERN = /^cus_[0-9a-z]{1,24}$/
export const MAX_TOTAL_CENTS = 1_000_000_00

export type Order = {
  id: string
  customerId: string
  email: string
  totalCents: number
}

function text(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw httpError(400, `"${field}" is required`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxChars) {
    throw httpError(400, `"${field}" is longer than ${maxChars} characters`)
  }
  return trimmed
}

export function assertOrderId(value: unknown): string {
  const id = text(value, 'id', 28)
  if (!ORDER_ID_PATTERN.test(id)) {
    throw httpError(400, 'An order id looks like ord_7f3a91')
  }
  return id
}

export function parseOrder(body: unknown): Omit<Order, 'id'> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw httpError(400, 'The body must be a JSON object')
  }
  const candidate = body as Record<string, unknown>

  const customerId = text(candidate.customerId, 'customerId', 28)
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw httpError(400, 'A customer id looks like cus_7f3a91')
  }

  const totalCents = candidate.totalCents
  if (
    typeof totalCents !== 'number' ||
    !Number.isInteger(totalCents) ||
    totalCents <= 0 ||
    totalCents > MAX_TOTAL_CENTS
  ) {
    throw httpError(400, '"totalCents" must be a whole number of cents above zero')
  }

  return { customerId, email: text(candidate.email, 'email', 254), totalCents }
}
