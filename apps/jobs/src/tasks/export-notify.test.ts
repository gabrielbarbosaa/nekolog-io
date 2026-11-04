import type { EmailMessage, ExportNotice } from '@nekolog-io/adapters'
import { EXPORT_LIFETIME_DAYS, memoryExportStore } from '@nekolog-io/adapters'
import { describe, expect, it } from 'vitest'
import type { TaskContext } from '../task.ts'
import {
  type ExportNotifyEvent,
  type ExportNotifyReport,
  exportNotifyTask,
} from './export-notify.ts'

const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000
const DASHBOARD = 'https://app.nekolog.io'
const EXPORT_ID = 'exp_01JBQ8R4T7V2WXYZ0123456789'

function context(signal = new AbortController().signal): TaskContext {
  return { scheduledAt: NOW, signal } as TaskContext
}

function readyExport(id = EXPORT_ID, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'prj_1',
    environmentId: 'env_prod',
    format: 'csv' as const,
    query: '',
    rangeFrom: NOW - DAY,
    rangeTo: NOW,
    status: 'ready' as const,
    cadence: 'daily' as const,
    recipient: { email: 'reader@example.com', locale: 'pt-BR' },
    objectKey: `exports/${id}.csv.gz`,
    rowCount: 10,
    byteSize: 1024,
    expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
    createdAt: NOW - 1000,
    ...overrides,
  }
}

type Harness = {
  sent: EmailMessage[]
  events: ExportNotifyEvent[]
  store: ReturnType<typeof memoryExportStore>
  run: (signal?: AbortSignal) => Promise<ExportNotifyReport>
}

function harness(send?: (message: EmailMessage) => Promise<void>): Harness {
  const sent: EmailMessage[] = []
  const events: ExportNotifyEvent[] = []
  const store = memoryExportStore()

  const task = exportNotifyTask({
    exports: store,
    dashboardUrl: DASHBOARD,
    now: () => NOW,
    onEvent: (event) => events.push(event),
    mailer: {
      async send(message) {
        sent.push(message)
        await send?.(message)
      },
    },
  })

  return {
    sent,
    events,
    store,
    run: async (signal) => (await task.run(context(signal))) as ExportNotifyReport,
  }
}

describe('the notice task', () => {
  it('sends one e-mail and records that it did', async () => {
    const one = harness()
    one.store.add(readyExport())

    const report = await one.run()

    expect(report).toMatchObject({ waiting: 1, sent: 1, failed: 0 })
    expect(one.sent[0]?.to).toBe('reader@example.com')
    expect(one.store.rows.get(EXPORT_ID)?.notifiedAt).toBe(NOW)
  })

  it('never sends the same notice twice', async () => {
    const one = harness()
    one.store.add(readyExport())

    await one.run()
    const second = await one.run()

    expect(second).toMatchObject({ waiting: 0, sent: 0 })
    expect(one.sent).toHaveLength(1)
  })

  it('writes to the reader in their own language', async () => {
    const one = harness()
    one.store.add(readyExport())

    await one.run()

    expect(one.sent[0]?.subject).toContain('diária')
  })

  it('sends a link and never the file', async () => {
    const one = harness()
    one.store.add(readyExport())

    await one.run()

    expect(one.sent[0]?.html).toContain(`${DASHBOARD}/exports/${EXPORT_ID}`)
    expect(Object.keys(one.sent[0] ?? {})).toEqual(['to', 'subject', 'html', 'text'])
  })

  it('leaves the export unnotified when the mail did not go out', async () => {
    const one = harness(async () => {
      throw new Error('Resend refused the address')
    })
    one.store.add(readyExport())

    const report = await one.run()

    expect(report).toMatchObject({ sent: 0, failed: 1 })
    expect(one.store.rows.get(EXPORT_ID)?.notifiedAt).toBeUndefined()
    expect(one.events).toContainEqual({
      kind: 'not_sent',
      id: EXPORT_ID,
      why: 'Resend refused the address',
    })
  })

  it('carries on with the next notice after one failed', async () => {
    let call = 0
    const one = harness(async () => {
      call += 1
      if (call === 1) {
        throw new Error('nope')
      }
    })
    one.store.add(readyExport('exp_01JBQ8R4T7V2WXYZ0123456781', { createdAt: NOW - 9000 }))
    one.store.add(readyExport('exp_01JBQ8R4T7V2WXYZ0123456782', { createdAt: NOW - 1000 }))

    expect(await one.run()).toMatchObject({ waiting: 2, sent: 1, failed: 1 })
  })

  it('says nothing about an export that is not ready yet', async () => {
    const one = harness()
    one.store.add(readyExport(EXPORT_ID, { status: 'pending' }))

    expect(await one.run()).toMatchObject({ waiting: 0, sent: 0 })
  })

  it('says nothing about an export nobody asked for', async () => {
    const one = harness()
    one.store.add(readyExport(EXPORT_ID, { recipient: undefined }))

    expect(await one.run()).toMatchObject({ waiting: 0, sent: 0 })
  })

  it('does not mark an export notified when the link could not be built', async () => {
    const one = harness()
    one.store.add(readyExport(EXPORT_ID, { recipient: { email: 'a@b.test', locale: 'en' } }))
    const notice = one.store.rows.get(EXPORT_ID)
    if (notice !== undefined) {
      notice.id = 'not-an-export-id'
      one.store.rows.set('not-an-export-id', notice)
      one.store.rows.delete(EXPORT_ID)
    }

    const report = await one.run()

    expect(report).toMatchObject({ sent: 0, failed: 1 })
    expect(one.sent).toEqual([])
  })

  it('says so rather than guessing when the store cannot be reached', async () => {
    const task = exportNotifyTask({
      exports: {
        claim: async () => [],
        markReady: async () => {},
        markFailed: async () => {},
        expire: async () => [],
        awaitingNotice: async () => {
          throw new Error('postgres is asleep')
        },
        markNotified: async () => {},
      },
      mailer: { async send() {} },
      dashboardUrl: DASHBOARD,
    })

    expect(await task.run(context())).toMatchObject({ stopped: 'store_unavailable', sent: 0 })
  })

  it('stops when the deadline passed rather than sending more', async () => {
    const controller = new AbortController()
    controller.abort()
    const one = harness()
    one.store.add(readyExport())

    const report = await one.run(controller.signal)

    expect(report.stopped).toBe('out_of_time')
    expect(one.sent).toEqual([])
  })
})

describe('what a notice carries', () => {
  it('reads the size and the count the run recorded', async () => {
    const one = harness()
    one.store.add(readyExport(EXPORT_ID, { rowCount: 4096, byteSize: 5242880 }))

    await one.run()

    expect(one.sent[0]?.text).toContain('4,096')
    expect(one.sent[0]?.text).toContain('5.0 MB')
  })

  it('treats a missing count as zero rather than writing undefined', async () => {
    const one = harness()
    one.store.add(readyExport(EXPORT_ID, { rowCount: undefined, byteSize: undefined }))

    await one.run()

    expect(one.sent[0]?.text).not.toContain('undefined')
    expect(one.sent[0]?.text).toContain('0 B')
  })
})

describe('the notice shape the store hands over', () => {
  it('is the one the template reads', () => {
    const one: ExportNotice = {
      id: EXPORT_ID,
      format: 'csv',
      cadence: 'daily',
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      rowCount: 1,
      byteSize: 1,
      expiresAt: NOW + DAY,
      locale: 'en',
      email: 'a@b.test',
    }

    expect(Object.keys(one).sort()).toEqual(
      [
        'byteSize',
        'cadence',
        'email',
        'expiresAt',
        'format',
        'id',
        'locale',
        'rangeFrom',
        'rangeTo',
        'rowCount',
      ].sort(),
    )
  })
})
