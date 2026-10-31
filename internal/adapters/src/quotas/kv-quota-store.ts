import type { KvNamespace } from '../kv'
import type { QuotaBlock, QuotaStore } from '../quota-store'

export const QUOTA_BLOCKS_KEY = 'quota:blocks'

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export function parseQuotaBlocks(raw: string): ReadonlyArray<QuotaBlock> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return []
  }

  const blocks: QuotaBlock[] = []
  for (const [environmentId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (environmentId === '') {
      continue
    }
    const body = (typeof value === 'object' && value !== null ? value : {}) as Record<
      string,
      unknown
    >
    blocks.push({
      environmentId,
      blockedAt: count(body.blockedAt),
      events: count(body.events),
      quota: count(body.quota),
    })
  }

  return blocks
}

export function serialiseQuotaBlocks(blocks: ReadonlyArray<QuotaBlock>): string {
  const document: Record<string, { blockedAt: number; events: number; quota: number }> = {}
  for (const block of blocks) {
    if (block.environmentId === '') {
      continue
    }
    document[block.environmentId] = {
      blockedAt: block.blockedAt,
      events: block.events,
      quota: block.quota,
    }
  }
  return JSON.stringify(document)
}

export function kvQuotaStore(namespace: KvNamespace): QuotaStore {
  return {
    async blocked() {
      const raw = await namespace.get(QUOTA_BLOCKS_KEY, 'text')
      return raw === null ? [] : parseQuotaBlocks(raw)
    },

    async replace(blocks) {
      if (blocks.length === 0) {
        await namespace.delete(QUOTA_BLOCKS_KEY)
        return
      }
      await namespace.put(QUOTA_BLOCKS_KEY, serialiseQuotaBlocks(blocks))
    },
  }
}
