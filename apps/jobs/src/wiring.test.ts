import { describe, expect, it, vi } from 'vitest'
import type { RunSummary } from './run.ts'
import { dailyQuotaFrom, writeSpoolEvent, writeSummary } from './wiring.ts'

function summary(partial: Partial<RunSummary> = {}): RunSummary {
  return {
    cron: '* * * * *',
    scheduledAt: Date.UTC(2026, 9, 31, 12, 0, 0),
    durationMs: 1,
    ran: [],
    skipped: [],
    failed: 0,
    ...partial,
  }
}

describe('dailyQuotaFrom', () => {
  it('leaves the quota unset when nothing asks for one', () => {
    expect(dailyQuotaFrom(undefined)).toBeUndefined()
    expect(dailyQuotaFrom('')).toBeUndefined()
  })

  it('takes a positive whole number', () => {
    expect(dailyQuotaFrom('500000')).toBe(500_000)
  })

  it.each(['lots', '0', '-1', '1.5'])('refuses %s rather than guess a quota', (value) => {
    expect(() => dailyQuotaFrom(value)).toThrow(/DAILY_EVENT_QUOTA/)
  })
})

describe('writeSummary', () => {
  it('writes one JSON line tagged with the app', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    writeSummary(summary({ failed: 1 }))

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      app: 'nekolog/jobs',
      failed: 1,
    })
    log.mockRestore()
  })

  it('stays quiet when there is no console to write to', () => {
    const original = globalThis.console
    Object.defineProperty(globalThis, 'console', { value: undefined, configurable: true })

    try {
      expect(() => writeSummary(summary())).not.toThrow()
    } finally {
      Object.defineProperty(globalThis, 'console', { value: original, configurable: true })
    }
  })
})

describe('writeSpoolEvent', () => {
  it('warns about a file that did not go through', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    writeSpoolEvent({ kind: 'quarantined', key: 'spool/a.json', why: 'not JSON' })

    expect(String(warn.mock.calls[0]?.[1])).toContain('quarantined')
    warn.mockRestore()
  })

  it('stays silent on the normal case, which happens every minute', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    writeSpoolEvent({ kind: 'resent', key: 'spool/a.json', rows: 3 })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
