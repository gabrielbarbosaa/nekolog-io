import type { ParsedBatch } from '@internal/schema'
import { MAX_ATTRIBUTE_KEY_CHARS } from '@internal/schema'
import { describe, expect, it } from 'vitest'
import type { IngestPrincipal } from './app.ts'
import {
  createAttributeBudget,
  MAX_ATTRIBUTE_KEYS_PER_PROJECT,
  MAX_TRACKED_PROJECTS,
} from './attributes.ts'
import { ERROR_MESSAGE_ATTRIBUTE, rowsFor } from './rows.ts'

const PRINCIPAL: IngestPrincipal = { projectId: 'p_1', environmentId: 'e_1' }

function batchWith(attributes: Record<string, string | number | boolean | null>): ParsedBatch {
  return {
    batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10',
    resource: { service: 'checkout-api', runtime: 'node' },
    accepted: [
      {
        index: 0,
        event: {
          timestamp: '2026-10-31T12:00:00.000Z',
          level: 'info',
          message: 'hello',
          attributes,
        },
      },
    ],
    rejected: [],
  } as unknown as ParsedBatch
}

describe('createAttributeBudget', () => {
  it('lets a project through until it has spent its key budget', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 3 })

    expect(budget.admit('p_1', 'a')).toBe(true)
    expect(budget.admit('p_1', 'b')).toBe(true)
    expect(budget.admit('p_1', 'c')).toBe(true)
    expect(budget.admit('p_1', 'd')).toBe(false)
    expect(budget.known('p_1')).toBe(3)
  })

  it('keeps accepting the keys it already knows after the budget is spent', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 2 })

    budget.admit('p_1', 'orderId')
    budget.admit('p_1', 'amount')
    expect(budget.admit('p_1', 'newOne')).toBe(false)
    expect(budget.admit('p_1', 'orderId')).toBe(true)
  })

  it('counts a repeated key once', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 2 })

    budget.admit('p_1', 'orderId')
    budget.admit('p_1', 'orderId')

    expect(budget.known('p_1')).toBe(1)
  })

  it('gives each project its own budget', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 1 })

    expect(budget.admit('p_1', 'a')).toBe(true)
    expect(budget.admit('p_1', 'b')).toBe(false)
    expect(budget.admit('p_2', 'b')).toBe(true)
  })

  it('counts what it dropped', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 1 })

    budget.admit('p_1', 'a')
    budget.admit('p_1', 'b')
    budget.admit('p_1', 'c')

    expect(budget.dropped).toBe(2)
  })

  it('forgets the oldest project rather than tracking every project forever', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 1, maxProjects: 2 })

    budget.admit('p_1', 'a')
    budget.admit('p_2', 'a')
    budget.admit('p_3', 'a')

    expect(budget.known('p_1')).toBe(0)
    expect(budget.known('p_3')).toBe(1)
  })

  it('refuses to be built with room for no project at all', () => {
    expect(() => createAttributeBudget({ maxProjects: 0 })).toThrow(/at least one project/)
    expect(() => createAttributeBudget({ maxProjects: 1.5 })).toThrow(/at least one project/)
  })

  it('ships limits that match the documented product rule', () => {
    expect(MAX_ATTRIBUTE_KEYS_PER_PROJECT).toBe(500)
    expect(MAX_TRACKED_PROJECTS).toBeGreaterThan(0)
  })

  it('cannot grow past the memory a Worker can spare', () => {
    const worstCaseBytes =
      MAX_TRACKED_PROJECTS * MAX_ATTRIBUTE_KEYS_PER_PROJECT * (MAX_ATTRIBUTE_KEY_CHARS * 2 + 80)

    expect(worstCaseBytes).toBeLessThan(16 * 1024 * 1024)
  })
})

describe('rowsFor with a budget', () => {
  const context = (admit?: (key: string) => boolean) => ({
    receivedAt: Date.UTC(2026, 9, 31, 12, 0, 0),
    country: 'BR',
    ...(admit === undefined ? {} : { admitAttribute: admit }),
  })

  it('writes every attribute when nothing is budgeting them', () => {
    const [row] = rowsFor(batchWith({ a: '1', b: '2' }), PRINCIPAL, context())

    expect(row?.attributes).toEqual({ a: '1', b: '2' })
  })

  it('leaves out the keys the budget refused', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 1 })
    const [row] = rowsFor(
      batchWith({ a: '1', b: '2' }),
      PRINCIPAL,
      context((key) => budget.admit('p_1', key)),
    )

    expect(row?.attributes).toEqual({ a: '1' })
  })

  it('keeps the event itself, it only drops the extra keys', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 0 })
    const rows = rowsFor(
      batchWith({ a: '1' }),
      PRINCIPAL,
      context((key) => budget.admit('p_1', key)),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.message).toBe('hello')
    expect(rows[0]?.attributes).toEqual({})
  })

  it('never spends the budget on the error message it adds itself', () => {
    const budget = createAttributeBudget({ maxKeysPerProject: 0 })
    const batch = batchWith({})
    const accepted = batch.accepted[0]
    if (accepted !== undefined) {
      ;(accepted.event as { error?: unknown }).error = { type: 'Error', message: 'boom' }
    }

    const [row] = rowsFor(
      batch,
      PRINCIPAL,
      context((key) => budget.admit('p_1', key)),
    )

    expect(row?.attributes).toEqual({ [ERROR_MESSAGE_ATTRIBUTE]: 'boom' })
  })
})
