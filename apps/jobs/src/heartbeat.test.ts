import { describe, expect, it } from 'vitest'
import { heartbeatUrlFor, sendHeartbeat } from './heartbeat.ts'
import type { RunSummary } from './run.ts'

const URL = 'https://uptime.example.test/heartbeat/abc'

function summaryWith(failed: number): RunSummary {
  return {
    cron: '* * * * *',
    scheduledAt: 1_700_000_000_000,
    durationMs: 120,
    ran: [{ name: 'spool-resend', status: failed === 0 ? 'ok' : 'failed', durationMs: 10 }],
    skipped: [],
    failed,
  }
}

function recorder(answer: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  const calls: Array<{ url: string; body: string | undefined }> = []
  return {
    calls,
    fetch: (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body })
      return Promise.resolve(answer)
    },
  }
}

describe('heartbeatUrlFor', () => {
  it('pings the monitor when nothing failed', () => {
    expect(heartbeatUrlFor(URL, summaryWith(0))).toBe(URL)
  })

  it('pings the failure path when a task failed, so the monitor knows which it is', () => {
    expect(heartbeatUrlFor(URL, summaryWith(1))).toBe(`${URL}/fail`)
  })

  it('does not double the slash of a url that ends in one', () => {
    expect(heartbeatUrlFor(`${URL}/`, summaryWith(1))).toBe(`${URL}/fail`)
  })
})

describe('sendHeartbeat', () => {
  it('reports what ran, without the task output', async () => {
    const monitor = recorder()

    await sendHeartbeat(summaryWith(0), { url: URL, fetch: monitor.fetch })

    expect(monitor.calls).toHaveLength(1)
    expect(JSON.parse(monitor.calls[0]?.body ?? '{}')).toEqual({
      cron: '* * * * *',
      scheduledAt: 1_700_000_000_000,
      durationMs: 120,
      ran: 1,
      failed: 0,
    })
  })

  it('swallows a monitor that is down, because a run is not a failure for it', async () => {
    const problems: string[] = []
    const broken = () => Promise.reject(new Error('the monitor is unreachable'))

    await expect(
      sendHeartbeat(summaryWith(0), {
        url: URL,
        fetch: broken,
        onProblem: (reason) => problems.push(reason),
      }),
    ).resolves.toBeUndefined()
    expect(problems).toEqual(['the monitor is unreachable'])
  })

  it('says so when the monitor answers an error status', async () => {
    const problems: string[] = []
    const monitor = recorder({ ok: false, status: 503 })

    await sendHeartbeat(summaryWith(0), {
      url: URL,
      fetch: monitor.fetch,
      onProblem: (reason) => problems.push(reason),
    })

    expect(problems).toEqual(['the monitor answered 503'])
  })

  it('says so instead of throwing when the runtime has no fetch', async () => {
    const problems: string[] = []
    const previous = (globalThis as { fetch?: unknown }).fetch
    ;(globalThis as { fetch?: unknown }).fetch = undefined

    await sendHeartbeat(summaryWith(0), {
      url: URL,
      onProblem: (reason) => problems.push(reason),
    })
    ;(globalThis as { fetch?: unknown }).fetch = previous

    expect(problems).toEqual(['this runtime has no fetch'])
  })
})
