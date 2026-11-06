import type { SeedDocument } from '@internal/seed'
import { fileBlobStore, fileKvNamespace, fileSeedKeyStore } from '@internal/self-host'
import {
  cachedBlockedEnvironments,
  cachedKeyStore,
  firstKeyStore,
  kvKeyStore,
  kvQuotaStore,
} from '@nekolog-io/adapters'
import type { LocalIngestOptions } from './local.ts'
import { type LocalIngestConfig, type LocalIngestEnv, localIngestConfigFrom } from './local.ts'
import type { SpooledBatch } from './sink.ts'

export const DEFAULT_SELF_HOST_HOST = '0.0.0.0'

export type SelfHostIngestEnv = LocalIngestEnv & {
  SPOOL_DIR?: string
  KV_DIR?: string
}

export type SelfHostIngestConfig = LocalIngestConfig & {
  spoolDir: string
  kvDir: string
}

const REQUIRED: ReadonlyArray<keyof SelfHostIngestEnv> = ['SPOOL_DIR', 'KV_DIR']

export function selfHostIngestConfigFrom(env: SelfHostIngestEnv): SelfHostIngestConfig {
  const missing = REQUIRED.filter((name) => {
    const value = env[name]
    return value === undefined || value === ''
  })
  if (missing.length > 0) {
    throw new Error(
      `The self-host ingest container is missing ${missing.join(', ')}. ` +
        'Copy deploy/self-host/.env.example to .env and fill every value in.',
    )
  }

  const local = localIngestConfigFrom({
    ...env,
    INGEST_HOST:
      env.INGEST_HOST === undefined || env.INGEST_HOST === ''
        ? DEFAULT_SELF_HOST_HOST
        : env.INGEST_HOST,
  })

  return {
    ...local,
    spoolDir: env.SPOOL_DIR as string,
    kvDir: env.KV_DIR as string,
  }
}

export type SelfHostIngestOptions = {
  config: SelfHostIngestConfig
  document: SeedDocument
  seedFile: string
  onError?: (error: unknown) => void
  onReload?: (document: SeedDocument) => void
  onSpooled?: (spooled: SpooledBatch) => void
}

export function selfHostIngestWiring(options: SelfHostIngestOptions): LocalIngestOptions {
  return {
    config: options.config,
    document: options.document,
    keyStore: firstKeyStore(
      cachedKeyStore(kvKeyStore(fileKvNamespace(options.config.kvDir))),
      fileSeedKeyStore(options.seedFile, {
        ...(options.onReload === undefined ? {} : { onReload: options.onReload }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      }),
    ),
    spool: fileBlobStore(options.config.spoolDir),
    blocks: cachedBlockedEnvironments(kvQuotaStore(fileKvNamespace(options.config.kvDir)), {
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onSpooled === undefined ? {} : { onSpooled: options.onSpooled }),
  }
}
