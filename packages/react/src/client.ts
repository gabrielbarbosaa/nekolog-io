import { type BrowserClient, type InitOptions, init } from '@nekolog-io/browser'
import { SDK_NAME, SDK_VERSION } from './version.ts'

let shared: BrowserClient | undefined

export function nekologClient(options: InitOptions = {}): BrowserClient {
  if (shared === undefined) {
    shared = init({ sdk: { name: SDK_NAME, version: SDK_VERSION }, ...options })
  }
  return shared
}

export function currentClient(): BrowserClient | undefined {
  return shared
}

export async function closeClient(): Promise<void> {
  const client = shared
  shared = undefined
  await client?.close()
}
