import { type ChildProcess, spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const isBuilt = existsSync(join(ROOT, '.next', 'BUILD_ID'))

export function requireBuild(): void {
  if (isBuilt) {
    return
  }
  if (process.env.DASHBOARD_HEADERS_TEST_REQUIRED === '1') {
    throw new Error(
      'DASHBOARD_HEADERS_TEST_REQUIRED is set but apps/dashboard has no production build. ' +
        'These tests must not be skipped here: run `pnpm --filter @apps/dashboard build` first.',
    )
  }
  process.stderr.write(
    '\nSkipping the tests that need a running apps/dashboard: it has no production build.\n' +
      'Run `pnpm --filter @apps/dashboard build` first.\n\n',
  )
}

export async function startNext(port: number): Promise<ChildProcess> {
  const bin = join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next')
  const pair = generateKeyPairSync('ed25519')

  const server = spawn(process.execPath, [bin, 'start', '-p', `${port}`], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      AUTH_JWT_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      AUTH_JWT_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
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
