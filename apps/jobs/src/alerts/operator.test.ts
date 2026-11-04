import { describe, expect, it } from 'vitest'
import type { Fetcher } from './deliver.ts'
import {
  capacityAlert,
  MAX_OPERATOR_DETAIL_CHARS,
  OPERATOR_SEVERITIES,
  type OperatorAlert,
  operatorBody,
  operatorNotifier,
  quotaAlert,
  spoolAlert,
} from './operator.ts'

const WEBHOOK = 'https://discord.com/api/webhooks/1/abcdef'

type Sent = { url: string; init: Parameters<Fetcher>[1] }

function harness(answer: { ok?: boolean; status?: number } = {}) {
  const sent: Sent[] = []
  const written: OperatorAlert[] = []
  const undelivered: Array<{ alert: OperatorAlert; why: string }> = []

  const fetcher: Fetcher = async (url, init) => {
    sent.push({ url, init })
    return {
      ok: answer.ok ?? true,
      status: answer.status ?? 204,
      async text() {
        return ''
      },
    }
  }

  return {
    sent,
    written,
    undelivered,
    notify: operatorNotifier({
      webhookUrl: WEBHOOK,
      fetch: fetcher,
      environment: 'prod',
      onWrite: (alert) => written.push(alert),
      onUndelivered: (alert, why) => undelivered.push({ alert, why }),
    }),
  }
}

describe('turning a task event into an operator alert', () => {
  it('calls a disk running out critical, and a filling spool a warning', () => {
    expect(
      capacityAlert({ kind: 'disk-low', disk: '/var/lib', freeRatio: 0.03, threshold: 0.1 })
        .severity,
    ).toBe('critical')
    expect(
      capacityAlert({ kind: 'spool-backlog', pending: 90, threshold: 50, capped: false }).severity,
    ).toBe('warning')
  })

  it('calls "I cannot measure" critical, which is the rule everywhere else too', () => {
    const alert = capacityAlert({ kind: 'unreadable', what: 'disk', why: 'fetch failed' })

    expect(alert.severity).toBe('critical')
    expect(alert.detail).toContain('fetch failed')
  })

  it('says what was measured and what the limit was', () => {
    const alert = capacityAlert({
      kind: 'disk-low',
      disk: '/var/lib',
      freeRatio: 0.03,
      threshold: 0.1,
    })

    expect(alert.detail).toContain('/var/lib')
    expect(alert.detail).toContain('3.0%')
    expect(alert.detail).toContain('10.0%')
  })

  it('raises an alert when an environment is blocked, and not when it is let back in', () => {
    const blocked = quotaAlert({
      kind: 'blocked',
      environmentId: 'env_1',
      events: 1_000_000,
      quota: 500_000,
    })

    expect(blocked?.kind).toBe('quota-blocked')
    expect(blocked?.detail).toContain('env_1')
    expect(
      quotaAlert({ kind: 'unblocked', environmentId: 'env_1', events: 1, quota: 2 }),
    ).toBeNull()
  })

  it('says nothing about a spooled batch that was replayed as intended', () => {
    expect(spoolAlert({ kind: 'resent', key: 'spool/a', rows: 10 })).toBeNull()
  })

  it('tells a quarantined batch from one that could not be replayed at all', () => {
    expect(spoolAlert({ kind: 'quarantined', key: 'spool/a', why: 'too old' })?.severity).toBe(
      'warning',
    )
    expect(
      spoolAlert({ kind: 'blocked', key: 'spool/a', error: new Error('ClickHouse said no') })
        ?.severity,
    ).toBe('critical')
  })

  it('warns loudly about a batch replayed but not deleted, which would be written twice', () => {
    const alert = spoolAlert({ kind: 'undeleted', key: 'spool/a', error: new Error('R2 is down') })

    expect(alert?.severity).toBe('critical')
    expect(alert?.detail).toContain('R2 is down')
  })

  it('never writes a novel into the detail', () => {
    const alert = spoolAlert({
      kind: 'blocked',
      key: 'spool/a',
      error: new Error('x'.repeat(5000)),
    })

    expect(alert?.detail.length).toBeLessThanOrEqual(MAX_OPERATOR_DETAIL_CHARS)
  })

  it('uses only the severities the contract names', () => {
    const alerts = [
      capacityAlert({ kind: 'disk-low', disk: 'd', freeRatio: 0, threshold: 1 }),
      capacityAlert({ kind: 'spool-backlog', pending: 1, threshold: 0, capped: true }),
      capacityAlert({ kind: 'unreadable', what: 'spool', why: 'x' }),
      quotaAlert({ kind: 'blocked', environmentId: 'e', events: 2, quota: 1 }),
      spoolAlert({ kind: 'quarantined', key: 'k', why: 'x' }),
    ].filter((one): one is OperatorAlert => one !== null)

    for (const alert of alerts) {
      expect(OPERATOR_SEVERITIES).toContain(alert.severity)
    }
  })
})

describe('the message it posts', () => {
  it('names the environment, so two deployments are not confused', () => {
    const body = JSON.parse(
      operatorBody(
        { severity: 'critical', kind: 'disk-low', headline: 'A disk is full', detail: 'd' },
        'prod',
      ),
    )

    expect(body.content).toContain('[prod]')
    expect(body.content).toContain('CRITICAL')
  })

  it('leaves the brackets out when there is no environment to name', () => {
    const body = JSON.parse(
      operatorBody({ severity: 'warning', kind: 'k', headline: 'h', detail: 'd' }, ''),
    )

    expect(body.content).not.toContain('[')
  })
})

describe('delivering it', () => {
  const ALERT: OperatorAlert = {
    severity: 'critical',
    kind: 'disk-low',
    headline: 'A disk is full',
    detail: 'nearly nothing left',
  }

  it('posts it, and writes it down either way', async () => {
    const one = harness()

    await one.notify(ALERT)

    expect(one.sent).toHaveLength(1)
    expect(one.written).toEqual([ALERT])
    expect(one.undelivered).toEqual([])
  })

  it('never follows a redirect and always carries a deadline', async () => {
    const one = harness()

    await one.notify(ALERT)

    expect(one.sent[0]?.init.redirect).toBe('manual')
    expect(one.sent[0]?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('refuses an operator webhook the SSRF guard rejects', async () => {
    const sent: Sent[] = []
    const undelivered: Array<{ why: string }> = []
    const notify = operatorNotifier({
      webhookUrl: 'http://169.254.169.254/latest/',
      fetch: async (url, init) => {
        sent.push({ url, init })
        return {
          ok: true,
          status: 204,
          async text() {
            return ''
          },
        }
      },
      onUndelivered: (_alert, why) => undelivered.push({ why }),
    })

    await notify(ALERT)

    expect(sent).toEqual([])
    expect(undelivered[0]?.why).toMatch(/Refusing/)
  })

  it('still writes the alert down when nothing is configured to send it', async () => {
    const written: OperatorAlert[] = []
    const undelivered: Array<{ why: string }> = []
    const notify = operatorNotifier({
      onWrite: (alert) => written.push(alert),
      onUndelivered: (_alert, why) => undelivered.push({ why }),
    })

    await notify(ALERT)

    expect(written).toEqual([ALERT])
    expect(undelivered[0]?.why).toContain('no operator webhook')
  })

  it('never throws back into the task that raised the alert', async () => {
    const notify = operatorNotifier({
      webhookUrl: WEBHOOK,
      fetch: async () => {
        throw new Error('Discord is down')
      },
    })

    await expect(notify(ALERT)).resolves.toBeUndefined()
  })

  it('says the endpoint refused, rather than reporting it as sent', async () => {
    const one = harness({ ok: false, status: 429 })

    await one.notify(ALERT)

    expect(one.undelivered[0]?.why).toContain('429')
  })
})
