import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const isBuilt = existsSync(join(ROOT, '.next', 'BUILD_ID'))

export function requireBuild(): void {
  if (isBuilt) {
    return
  }
  if (process.env.WEB_HEADERS_TEST_REQUIRED === '1') {
    throw new Error(
      'WEB_HEADERS_TEST_REQUIRED is set but apps/web has no production build. ' +
        'These tests must not be skipped here: run `pnpm --filter @apps/web build` first.',
    )
  }
  process.stderr.write(
    '\nSkipping the tests that need a running apps/web: it has no production build.\n' +
      'Run `pnpm --filter @apps/web build` first.\n\n',
  )
}

export async function startNext(port: number): Promise<ChildProcess> {
  const bin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  const server = spawn(process.execPath, [bin, 'start', '-p', `${port}`], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  server.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1_000) })
      return server
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  server.kill()
  throw new Error(`next start never answered on port ${port}`)
}

export function nonceOf(response: Response): string | undefined {
  return /'nonce-([^']+)'/.exec(response.headers.get('content-security-policy') ?? '')?.[1]
}
