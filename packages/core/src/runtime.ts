import { RUNTIMES } from './limits.ts'
import type { Runtime } from './types.ts'

type GlobalProbe = {
  Deno?: unknown
  Bun?: unknown
  EdgeRuntime?: unknown
  document?: unknown
  navigator?: { userAgent?: unknown }
  process?: { versions?: { node?: unknown } }
}

export function isRuntime(value: unknown): value is Runtime {
  return typeof value === 'string' && (RUNTIMES as readonly string[]).includes(value)
}

export function detectRuntime(global: unknown = globalThis): Runtime {
  const probe = (global ?? {}) as GlobalProbe

  if (probe.Deno !== undefined) {
    return 'deno'
  }
  if (probe.Bun !== undefined) {
    return 'bun'
  }
  if (probe.EdgeRuntime !== undefined || probe.navigator?.userAgent === 'Cloudflare-Workers') {
    return 'edge'
  }
  if (probe.process?.versions?.node !== undefined) {
    return 'node'
  }
  if (probe.document !== undefined) {
    return 'browser'
  }
  return 'browser'
}
