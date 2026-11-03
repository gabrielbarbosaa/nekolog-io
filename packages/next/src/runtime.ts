export const NEXT_RUNTIME_ENV = 'NEXT_RUNTIME'

export type NextRuntime = 'nodejs' | 'edge' | 'browser'

export function nextRuntime(
  env: Record<string, string | undefined> = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env ?? {},
): NextRuntime {
  const declared = env[NEXT_RUNTIME_ENV]
  if (declared === 'edge') {
    return 'edge'
  }
  if (declared === 'nodejs') {
    return 'nodejs'
  }
  return (globalThis as { document?: unknown }).document === undefined ? 'nodejs' : 'browser'
}
