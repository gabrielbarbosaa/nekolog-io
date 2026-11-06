import type { AlertChannel, NoticeOutcome, PendingAlert } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { DeliveryOptions, Fetcher } from '../alerts/deliver.ts'
import type { TaskContext } from '../task.ts'
import { type AlertNotifyEvent, type AlertNotifyReport, alertNotifyTask } from './alert-notify.ts'

const AT = Date.UTC(2026, 10, 4, 12, 0, 0)
const DASHBOARD = 'https://app.nekolog.io'
const ENVIRONMENT = 'env_01JBQ8R4T7V2WXYZ0123456789'
const RULE = 'alr_01JBQ8R4T7V2WXYZ0123456789'
const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'
const OTHER_CHANNEL = 'ch_01JBQ8R4T7V2WXYZ012345678A'

function alert(overrides: Partial<PendingAlert> = {}): PendingAlert {
  return {
    ruleId: RULE,
    projectId: 'prj_1',
    environmentId: ENVIRONMENT,
    environmentName: 'production',
    ruleName: 'too many errors',
    state: 'firing',
    measured: 99,
    threshold: 50,
    window: '5m',
    query: 'level:error',
    type: 'threshold',
    channels: [CHANNEL],
    changedAt: AT,
    cooldownMinutes: 30,
    lastFiringNoticeAt: null,
    ...overrides,
  }
}

function channel(id: string, overrides: Partial<AlertChannel> = {}): AlertChannel {
  return {
    id,
    projectId: 'prj_1',
    name: id,
    kind: 'slack',
    target: 'https://hooks.slack.com/services/T000/B000/XXXX',
    sealedSecret: null,
    previousSealedSecret: null,
    locale: 'en',
    ...overrides,
  }
}

function context(signal = new AbortController().signal): TaskContext {
  return { scheduledAt: AT, signal } as TaskContext
}

type Harness = {
  sent: string[]
  notified: Array<{ ruleId: string; at: number }>
  outcomes: Array<{ ruleId: string; outcome: NoticeOutcome }>
  events: AlertNotifyEvent[]
  run: (signal?: AbortSignal) => Promise<AlertNotifyReport>
}

function harness(
  alerts: PendingAlert[],
  channels: AlertChannel[],
  extras: {
    post?: Fetcher
    byIds?: () => Promise<ReadonlyArray<AlertChannel>>
    awaiting?: () => Promise<ReadonlyArray<PendingAlert>>
  } = {},
): Harness {
  const sent: string[] = []
  const notified: Array<{ ruleId: string; at: number }> = []
  const outcomes: Array<{ ruleId: string; outcome: NoticeOutcome }> = []
  const events: AlertNotifyEvent[] = []
  let pruned = 0

  const delivery: DeliveryOptions = {
    dashboardUrl: DASHBOARD,
    fetch:
      extras.post ??
      (async (url) => {
        sent.push(url)
        return {
          ok: true,
          status: 200,
          async text() {
            return ''
          },
        }
      }),
  }

  const task = alertNotifyTask({
    notices: {
      awaitingNotice: extras.awaiting ?? (async () => alerts),
      async markNotified(ruleId, at) {
        notified.push({ ruleId, at })
      },
      async recordOutcome(ruleId, _changedAt, outcome) {
        outcomes.push({ ruleId, outcome })
      },
      async prune() {
        pruned += 1
        return pruned
      },
    },
    channels: {
      byIds:
        extras.byIds ?? (async (_projectId, ids) => channels.filter((one) => ids.includes(one.id))),
    },
    delivery,
    now: () => AT,
    onEvent: (event) => events.push(event),
  })

  return {
    sent,
    notified,
    outcomes,
    events,
    run: async (signal) => (await task.run(context(signal))) as AlertNotifyReport,
  }
}

describe('the notify task', () => {
  it('sends an alert to its channel and records that it did', async () => {
    const one = harness([alert()], [channel(CHANNEL)])

    const report = await one.run()

    expect(report).toMatchObject({ waiting: 1, sent: 1, failed: 0 })
    expect(one.sent).toHaveLength(1)
    expect(one.notified).toEqual([{ ruleId: RULE, at: AT }])
  })

  it('sends to every channel the rule names', async () => {
    const one = harness(
      [alert({ channels: [CHANNEL, OTHER_CHANNEL] })],
      [channel(CHANNEL), channel(OTHER_CHANNEL)],
    )

    expect(await one.run()).toMatchObject({ sent: 2 })
    expect(one.notified).toHaveLength(1)
  })

  it('never sends to a channel of another project, because the store scopes it', async () => {
    const asked: Array<{ projectId: string; ids: readonly string[] }> = []
    const one = harness([alert()], [], {
      byIds: (async (projectId: string, ids: readonly string[]) => {
        asked.push({ projectId, ids })
        return []
      }) as never,
    })

    await one.run()

    expect(asked).toEqual([{ projectId: 'prj_1', ids: [CHANNEL] }])
  })

  it('stops asking about a rule whose channels have all gone', async () => {
    const one = harness([alert()], [])

    const report = await one.run()

    expect(report).toMatchObject({ sent: 0, failed: 0 })
    expect(one.events).toContainEqual({ kind: 'no_channel', ruleId: RULE })
    expect(one.notified).toEqual([{ ruleId: RULE, at: AT }])
  })

  it('records the notice when at least one channel took it', async () => {
    let call = 0
    const one = harness(
      [alert({ channels: [CHANNEL, OTHER_CHANNEL] })],
      [channel(CHANNEL), channel(OTHER_CHANNEL)],
      {
        post: async (url) => {
          call += 1
          if (call === 1) {
            throw new Error('slack is down')
          }
          return {
            ok: true,
            status: 200,
            async text() {
              return url
            },
          }
        },
      },
    )

    const report = await one.run()

    expect(report).toMatchObject({ sent: 1, failed: 1 })
    expect(one.notified).toHaveLength(1)
  })

  it('leaves the alert unnotified when every channel refused, so the next run tries again', async () => {
    const one = harness([alert()], [channel(CHANNEL)], {
      post: async () => {
        throw new Error('slack is down')
      },
    })

    const report = await one.run()

    expect(report).toMatchObject({ sent: 0, failed: 1 })
    expect(one.notified).toEqual([])
  })

  it('carries on with the next alert after one failed', async () => {
    let call = 0
    const one = harness(
      [alert(), alert({ ruleId: 'alr_01JBQ8R4T7V2WXYZ012345678B' })],
      [channel(CHANNEL)],
      {
        post: async (url) => {
          call += 1
          if (call === 1) {
            throw new Error('nope')
          }
          return {
            ok: true,
            status: 200,
            async text() {
              return url
            },
          }
        },
      },
    )

    expect(await one.run()).toMatchObject({ waiting: 2, sent: 1, failed: 1 })
  })

  it('says why a channel refused, without the body of the request', async () => {
    const one = harness([alert()], [channel(CHANNEL)], {
      post: async () => ({
        ok: false,
        status: 429,
        async text() {
          return 'slow down'
        },
      }),
    })

    await one.run()

    const failure = one.events.find((event) => event.kind === 'not_sent')
    expect(failure).toMatchObject({ ruleId: RULE, channelId: CHANNEL })
    expect((failure as { why: string }).why).toContain('429')
  })

  it('does nothing at all when nothing is waiting', async () => {
    const one = harness([], [channel(CHANNEL)])

    expect(await one.run()).toMatchObject({ waiting: 0, sent: 0 })
    expect(one.sent).toEqual([])
  })

  it('says so rather than guessing when the store cannot be reached', async () => {
    const one = harness([], [], {
      awaiting: async () => {
        throw new Error('postgres is asleep')
      },
    })

    expect(await one.run()).toMatchObject({ stopped: 'store_unavailable', sent: 0 })
  })

  it('records in the history what each notice did', async () => {
    const one = harness([alert()], [channel(CHANNEL)])

    await one.run()

    expect(one.outcomes).toEqual([
      { ruleId: RULE, outcome: { notifiedAt: AT, channelsSent: 1, suppressed: null } },
    ])
  })

  it('records why a notice went nowhere, without pretending it was sent', async () => {
    const one = harness([alert()], [])

    await one.run()

    expect(one.outcomes).toEqual([
      { ruleId: RULE, outcome: { notifiedAt: null, channelsSent: 0, suppressed: 'no_channel' } },
    ])
  })

  it('writes no history for an alert whose channels all refused, so the retry is honest', async () => {
    const one = harness([alert()], [channel(CHANNEL)], {
      post: async () => {
        throw new Error('slack is down')
      },
    })

    await one.run()

    expect(one.outcomes).toEqual([])
  })

  it('prunes the history once the alerts are done', async () => {
    const one = harness([], [])

    expect(await one.run()).toMatchObject({ pruned: 1 })
  })
})

describe('the cooldown', () => {
  it('holds back a second firing notice inside the window', async () => {
    const one = harness(
      [alert({ lastFiringNoticeAt: AT - 10 * 60_000, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )

    const report = await one.run()

    expect(report).toMatchObject({ heldBack: 1, sent: 0 })
    expect(one.sent).toEqual([])
    expect(one.outcomes[0]?.outcome).toEqual({
      notifiedAt: null,
      channelsSent: 0,
      suppressed: 'cooldown',
    })
  })

  it('lets a firing notice through once the window has passed', async () => {
    const one = harness(
      [alert({ lastFiringNoticeAt: AT - 31 * 60_000, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )

    expect(await one.run()).toMatchObject({ heldBack: 0, sent: 1 })
  })

  it('never holds back the notice that says it is over', async () => {
    const one = harness(
      [alert({ state: 'ok', lastFiringNoticeAt: AT - 1000, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )

    const report = await one.run()

    expect(report).toMatchObject({ heldBack: 0, sent: 1 })
  })

  it('lets the very first firing notice through, having nothing to count from', async () => {
    const one = harness([alert({ lastFiringNoticeAt: null })], [channel(CHANNEL)])

    expect(await one.run()).toMatchObject({ heldBack: 0, sent: 1 })
  })

  it('stops offering an alert it held back, so it is not weighed again every minute', async () => {
    const one = harness(
      [alert({ lastFiringNoticeAt: AT - 60_000, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )

    await one.run()

    expect(one.notified).toEqual([{ ruleId: RULE, at: AT }])
  })

  it('holds back exactly at the boundary and not a millisecond later', async () => {
    const atBoundary = harness(
      [alert({ changedAt: AT, lastFiringNoticeAt: AT - 30 * 60_000, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )
    const justInside = harness(
      [alert({ changedAt: AT, lastFiringNoticeAt: AT - 30 * 60_000 + 1, cooldownMinutes: 30 })],
      [channel(CHANNEL)],
    )

    expect(await atBoundary.run()).toMatchObject({ sent: 1, heldBack: 0 })
    expect(await justInside.run()).toMatchObject({ sent: 0, heldBack: 1 })
  })

  it('counts a store that cannot list channels as a failure, not as no channel', async () => {
    const one = harness([alert()], [], {
      byIds: async () => {
        throw new Error('postgres is asleep')
      },
    })

    const report = await one.run()

    expect(report).toMatchObject({ failed: 1, sent: 0 })
    expect(one.notified).toEqual([])
  })

  it('stops when the deadline passed rather than sending more', async () => {
    const controller = new AbortController()
    controller.abort()
    const one = harness([alert()], [channel(CHANNEL)])

    const report = await one.run(controller.signal)

    expect(report.stopped).toBe('out_of_time')
    expect(one.sent).toEqual([])
  })
})
