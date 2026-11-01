import { type KeyRecord, type KeyStore, memoryKeyStore } from '@internal/adapters'
import type { SeedDocument } from './document.ts'

export type SeedKeyRecord = {
  keyHash: string
  record: KeyRecord
}

export function keyRecordsFor(document: SeedDocument): SeedKeyRecord[] {
  return document.environments.flatMap((environment) =>
    environment.keys.map((key) => ({
      keyHash: key.hash,
      record: {
        projectId: document.project.id,
        environmentId: environment.id,
        scopes: [...key.scopes],
        originAllowlist:
          environment.originAllowlist === null ? null : [...environment.originAllowlist],
        blocked: false,
        retentionDays: environment.retentionDays,
      },
    })),
  )
}

export async function writeKeyRecords(
  store: KeyStore,
  records: ReadonlyArray<SeedKeyRecord>,
): Promise<number> {
  for (const entry of records) {
    await store.set(entry.keyHash, entry.record)
  }
  return records.length
}

export async function keyStoreFromDocument(document: SeedDocument): Promise<KeyStore> {
  const store = memoryKeyStore()
  await writeKeyRecords(store, keyRecordsFor(document))
  return store
}

export function environmentNamed(document: SeedDocument, name: string): string {
  const environment = document.environments.find((entry) => entry.name === name)
  if (environment === undefined) {
    const known = document.environments.map((entry) => entry.name).join(', ')
    throw new Error(`This project has no environment called "${name}". It has: ${known}`)
  }
  return environment.id
}
