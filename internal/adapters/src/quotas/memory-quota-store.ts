import type { QuotaBlock, QuotaStore } from '../quota-store.ts'

export type MemoryQuotaStore = QuotaStore & {
  readonly size: number
  clear(): void
}

export function memoryQuotaStore(initial: Iterable<QuotaBlock> = []): MemoryQuotaStore {
  let blocks: QuotaBlock[] = [...initial].map((block) => ({ ...block }))

  return {
    get size() {
      return blocks.length
    },
    async blocked() {
      return blocks.map((block) => ({ ...block }))
    },
    async replace(next) {
      blocks = next.map((block) => ({ ...block }))
    },
    clear() {
      blocks = []
    },
  }
}
