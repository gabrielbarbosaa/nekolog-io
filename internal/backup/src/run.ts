import {
  type Command,
  type Destination,
  deleteCommand,
  dumpCommand,
  listCommand,
  uploadCommand,
} from './commands.ts'
import { type PipelineOptions, type PipelineResult, runPipeline } from './pipe.ts'
import { BACKUP_PREFIX, BackupRefused, expired, keyFor, takenAt } from './plan.ts'

export const DAY_MS = 86_400_000

export const MAX_DELETIONS_PER_RUN = 50

export const MAX_REASON_CHARS = 500

export type BackupAlert =
  | { kind: 'listing-unreadable'; why: string }
  | { kind: 'dump-failed'; why: string }
  | { kind: 'prune-failed'; why: string }

export type BackupReport = {
  state: 'done' | 'written' | 'unreadable' | 'failed'
  stored: number
  deleted: number
  key?: string
}

export type Runner = (
  steps: readonly Command[],
  options: PipelineOptions,
) => Promise<PipelineResult>

export type BackupRunOptions = {
  environment: string
  databaseUrl: string
  recipient: string
  destination: Destination
  keepDays?: number
  now?: () => number
  run?: Runner
  signal?: AbortSignal
  onAlert?: (alert: BackupAlert) => void
}

export function periodStart(at: number, periodMs: number = DAY_MS): number {
  if (!Number.isInteger(periodMs) || periodMs < 60_000) {
    throw new BackupRefused(`a backup period of ${periodMs}ms is not a period`)
  }
  return Math.floor(at / periodMs) * periodMs
}

export function keysFromListing(stdout: string, environment: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((name) => `${BACKUP_PREFIX}${environment}/${name}`)
}

export function scrub(value: unknown, secrets: readonly string[]): string {
  const text = value instanceof Error ? value.message : String(value)
  let safe = text
  for (const secret of secrets) {
    if (secret.trim() !== '') {
      safe = safe.split(secret).join('[redacted]')
    }
  }
  return safe.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_CHARS)
}

export async function runBackup(options: BackupRunOptions): Promise<BackupReport> {
  const now = options.now ?? Date.now
  const run = options.run ?? runPipeline
  const announce = options.onAlert ?? (() => undefined)
  const secrets = [
    options.destination.secretAccessKey,
    options.destination.accessKeyId,
    options.databaseUrl,
  ]
  const piping: PipelineOptions = options.signal === undefined ? {} : { signal: options.signal }

  let stored: string[]
  try {
    const listed = await run([listCommand(options.destination, options.environment)], piping)
    stored = keysFromListing(listed.stdout, options.environment)
  } catch (error) {
    announce({ kind: 'listing-unreadable', why: scrub(error, secrets) })
    return { state: 'unreadable', stored: 0, deleted: 0 }
  }

  const at = new Date(now())
  const since = periodStart(at.getTime())
  const thisPeriod = stored.filter((key) => (takenAt(key)?.getTime() ?? 0) >= since)

  if (thisPeriod.length > 0) {
    return { state: 'done', stored: stored.length, deleted: 0 }
  }

  const key = keyFor(options.environment, at)

  try {
    await run(
      [
        ...dumpCommand({ databaseUrl: options.databaseUrl, recipient: options.recipient }),
        uploadCommand(options.destination, key),
      ],
      piping,
    )
  } catch (error) {
    announce({ kind: 'dump-failed', why: scrub(error, secrets) })
    return { state: 'failed', stored: stored.length, deleted: 0 }
  }

  let deleted = 0
  try {
    const doomed = expired([...stored, key], {
      now: at,
      ...(options.keepDays === undefined ? {} : { keepDays: options.keepDays }),
    }).slice(0, MAX_DELETIONS_PER_RUN)

    for (const old of doomed) {
      await run([deleteCommand(options.destination, old)], piping)
      deleted += 1
    }
  } catch (error) {
    announce({ kind: 'prune-failed', why: scrub(error, secrets) })
  }

  return { state: 'written', stored: stored.length + 1, deleted, key }
}
