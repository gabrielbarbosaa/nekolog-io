import type { SqlRunner } from '../issues/sql-issue-store.ts'
import { openSecret, sealSecret, secretKeyBytes } from './secret-box.ts'

export const RESEAL_BATCH = 100

const SEALED = `
select id, sealed_secret, previous_sealed_secret
from alert_channels
where sealed_secret is not null or previous_sealed_secret is not null
order by id
limit $1 offset $2
`

const RESEALED = `
update alert_channels
set sealed_secret = $2, previous_sealed_secret = $3
where id = $1
  and sealed_secret is not distinct from $4
  and previous_sealed_secret is not distinct from $5
`

export type ResealReport = {
  looked: number
  resealed: number
  alreadyNew: number
  failed: ReadonlyArray<{ id: string; why: string }>
}

export type ResealOptions = {
  batch?: number
  dryRun?: boolean
  onChannel?: (id: string, outcome: 'resealed' | 'already_new' | 'failed') => void
}

async function moveOne(
  sealed: string | null,
  from: string,
  to: string,
  context: string,
): Promise<{ value: string | null; alreadyNew: boolean }> {
  if (sealed === null) {
    return { value: null, alreadyNew: false }
  }

  try {
    return {
      value: await sealSecret(await openSecret(sealed, from, context), to, context),
      alreadyNew: false,
    }
  } catch (withOld) {
    try {
      await openSecret(sealed, to, context)
      return { value: sealed, alreadyNew: true }
    } catch {
      throw withOld
    }
  }
}

export async function resealChannelSecrets(
  run: SqlRunner,
  oldKey: string,
  newKey: string,
  options: ResealOptions = {},
): Promise<ResealReport> {
  secretKeyBytes(oldKey)
  secretKeyBytes(newKey)

  if (oldKey === newKey) {
    throw new Error('Refusing to reseal onto the same key, which would change nothing')
  }

  const batch = options.batch ?? RESEAL_BATCH
  const failed: Array<{ id: string; why: string }> = []
  const report = { looked: 0, resealed: 0, alreadyNew: 0, failed }

  let offset = 0

  for (;;) {
    const rows = await run(SEALED, [batch, offset])
    if (rows.length === 0) {
      return report
    }

    for (const row of rows) {
      report.looked += 1
      const id = String(row.id)
      const current = row.sealed_secret === null ? null : String(row.sealed_secret)
      const previous =
        row.previous_sealed_secret === null ? null : String(row.previous_sealed_secret)

      try {
        const next = await moveOne(current, oldKey, newKey, id)
        const nextPrevious = await moveOne(previous, oldKey, newKey, id)

        if (next.value === current && nextPrevious.value === previous) {
          report.alreadyNew += 1
          options.onChannel?.(id, 'already_new')
          continue
        }

        if (options.dryRun !== true) {
          await run(RESEALED, [id, next.value, nextPrevious.value, current, previous])
        }

        report.resealed += 1
        options.onChannel?.(id, 'resealed')
      } catch (error) {
        failed.push({ id, why: error instanceof Error ? error.message : String(error) })
        options.onChannel?.(id, 'failed')
      }
    }

    offset += rows.length
  }
}
