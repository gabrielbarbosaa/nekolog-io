import type { RunSummary } from './run.ts'

export const HEARTBEAT_TIMEOUT_MS = 5_000

export type FetchLike = (
  input: string,
  init?: { method?: string; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>

export type HeartbeatOptions = {
  url: string
  fetch?: FetchLike
  timeoutMs?: number
  onProblem?: (reason: string) => void
}

function ambientFetch(): FetchLike | undefined {
  return (globalThis as { fetch?: FetchLike }).fetch
}

export function heartbeatUrlFor(url: string, summary: RunSummary): string {
  const base = url.endsWith('/') ? url.slice(0, -1) : url
  return summary.failed === 0 ? base : `${base}/fail`
}

export async function sendHeartbeat(summary: RunSummary, options: HeartbeatOptions): Promise<void> {
  const send = options.fetch ?? ambientFetch()
  if (send === undefined) {
    options.onProblem?.('this runtime has no fetch')
    return
  }

  const body = JSON.stringify({
    cron: summary.cron,
    scheduledAt: summary.scheduledAt,
    durationMs: summary.durationMs,
    ran: summary.ran.length,
    failed: summary.failed,
  })

  try {
    const response = await send(heartbeatUrlFor(options.url, summary), {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? HEARTBEAT_TIMEOUT_MS),
    })
    if (!response.ok) {
      options.onProblem?.(`the monitor answered ${response.status}`)
    }
  } catch (error) {
    options.onProblem?.(error instanceof Error ? error.message : String(error))
  }
}
