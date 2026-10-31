import { describe, expect, it } from 'vitest'
import {
  assertSafeBatchId,
  parseSpoolKey,
  QUARANTINE_PREFIX,
  quarantineKeyFor,
  SPOOL_PREFIX,
  spoolKey,
} from './key.ts'

const BATCH_ID = '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10'
const NOON = Date.UTC(2026, 9, 31, 12, 0, 0)

describe('spoolKey', () => {
  it('puts the batch under the spool prefix, stamped with the time', () => {
    expect(spoolKey(NOON, BATCH_ID)).toBe(`${SPOOL_PREFIX}${NOON}-${BATCH_ID}.json`)
  })

  it('sorts by time as plain text, which is how the sweep finds the oldest', () => {
    const keys = [
      spoolKey(NOON + 1_000, BATCH_ID),
      spoolKey(NOON, BATCH_ID),
      spoolKey(NOON + 60_000, BATCH_ID),
    ]

    expect([...keys].sort()).toEqual([keys[1], keys[0], keys[2]])
  })

  it('pads a short timestamp so the text order never breaks', () => {
    const early = spoolKey(1, BATCH_ID)
    const late = spoolKey(NOON, BATCH_ID)

    expect(early).toContain('0000000000001-')
    expect([late, early].sort()).toEqual([early, late])
  })

  it.each([
    '../../etc/passwd',
    'a/b',
    `${BATCH_ID}/x`,
    `${BATCH_ID}.json`,
    '',
    '01933B9E-7C1A-7D4F-9A51-3F0F6C2E8B10',
    '01933b9e7c1a7d4f9a513f0f6c2e8b10',
  ])('refuses to build a key from the batch id %s', (batchId) => {
    expect(() => spoolKey(NOON, batchId)).toThrow(/plain UUID/)
  })

  it.each([-1, 1.5, Number.NaN, 10 ** 14])('refuses the timestamp %s', (at) => {
    expect(() => spoolKey(at, BATCH_ID)).toThrow()
  })
})

describe('assertSafeBatchId', () => {
  it('returns the id it accepted', () => {
    expect(assertSafeBatchId(BATCH_ID)).toBe(BATCH_ID)
  })
})

describe('parseSpoolKey', () => {
  it('reads back what spoolKey wrote', () => {
    expect(parseSpoolKey(spoolKey(NOON, BATCH_ID))).toEqual({
      spooledAt: NOON,
      batchId: BATCH_ID,
    })
  })

  it.each([
    'spool/not-a-key.json',
    `spool/${NOON}-${BATCH_ID}`,
    `other/${NOON}-${BATCH_ID}.json`,
    `spool/${NOON}_${BATCH_ID}.json`,
    `spool/abcdefghijklm-${BATCH_ID}.json`,
    `spool/${NOON}-../escape.json`,
    'spool/',
  ])('refuses %s', (key) => {
    expect(parseSpoolKey(key)).toBeNull()
  })
})

describe('quarantineKeyFor', () => {
  it('moves the file to the quarantine prefix, keeping its name', () => {
    const key = spoolKey(NOON, BATCH_ID)

    expect(quarantineKeyFor(key)).toBe(`${QUARANTINE_PREFIX}${NOON}-${BATCH_ID}.json`)
  })

  it('never quarantines something outside the spool', () => {
    expect(() => quarantineKeyFor('exports/report.csv')).toThrow(/spool key/)
    expect(() => quarantineKeyFor(`${QUARANTINE_PREFIX}already.json`)).toThrow(/spool key/)
  })
})
