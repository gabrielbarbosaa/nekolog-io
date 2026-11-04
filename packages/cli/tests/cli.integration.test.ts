import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { runnerAt } from '../src/run.ts'

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.mjs')

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      `${CLI} is missing. The cli is tested as it ships, so run \`pnpm build\` first.`,
    )
  }
})

const folders: string[] = []

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true })
  }
})

async function project(manifest: unknown, files: Record<string, string> = {}): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'nekolog-cli-'))
  folders.push(folder)
  await writeFile(join(folder, 'package.json'), JSON.stringify(manifest), 'utf8')
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(folder, name), contents, 'utf8')
  }
  return folder
}

type Run = { code: number; out: string; err: string }

function run(args: readonly string[]): Promise<Run> {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })
    child.once('exit', (code) => settle({ code: code ?? 1, out, err }))
  })
}

describe('the cli as it ships', () => {
  it('runs at all, which a test that only imports it cannot show', async () => {
    const result = await run([])

    expect(result.code).toBe(0)
    expect(result.out).toContain('nekolog init')
  })

  it('sets up a hono project without touching the network', async () => {
    const folder = await project(
      { name: 'shop', dependencies: { hono: '4' } },
      {
        'pnpm-lock.yaml': '',
      },
    )

    const result = await run(['init', '--no-install', '--cwd', folder])

    expect(result.code).toBe(0)
    expect(result.out).toContain('hono')
    expect(result.out).toContain('pnpm add @nekolog-io/hono @nekolog-io/node')

    const written = await readFile(join(folder, '.env'), 'utf8')
    expect(written).toContain('NEKOLOG_KEY=nekolog_sk_replace_me')
  })

  it('writes the key it was given, in the right variable', async () => {
    const folder = await project({ name: 'site', dependencies: { next: '16' } })

    await run(['init', '--no-install', '--cwd', folder, '--key', 'nekolog_pk_abc123'])

    const written = await readFile(join(folder, '.env'), 'utf8')
    expect(written).toContain('NEXT_PUBLIC_NEKOLOG_KEY=nekolog_pk_abc123')
    expect(written).toContain('NEKOLOG_KEY=nekolog_sk_replace_me')
  })

  it('leaves a key that is already there alone', async () => {
    const folder = await project(
      { name: 'api', dependencies: { express: '5' } },
      {
        '.env': 'NEKOLOG_KEY=nekolog_sk_the_real_one\n',
      },
    )

    await run(['init', '--no-install', '--cwd', folder, '--key', 'nekolog_sk_another'])

    const written = await readFile(join(folder, '.env'), 'utf8')
    expect(written).toContain('nekolog_sk_the_real_one')
    expect(written).not.toContain('nekolog_sk_another')
  })

  it('refuses a folder that is not a project, and says what is missing', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nekolog-cli-'))
    folders.push(folder)

    const result = await run(['init', '--no-install', '--cwd', folder])

    expect(result.code).toBe(1)
    expect(result.err).toContain('package.json')
    expect(existsSync(join(folder, '.env'))).toBe(false)
  })

  it('refuses a key that is not one, and writes nothing', async () => {
    const folder = await project({ name: 'api', dependencies: { express: '5' } })

    const result = await run(['init', '--no-install', '--cwd', folder, '--key', 'hunter2'])

    expect(result.code).toBe(1)
    expect(result.err).toContain('nekolog_pk_')
    expect(existsSync(join(folder, '.env'))).toBe(false)
  })

  it('writes the file it was told to write', async () => {
    const folder = await project({ name: 'api', dependencies: { express: '5' } })

    await run(['init', '--no-install', '--cwd', folder, '--env', '.env.local'])

    expect(existsSync(join(folder, '.env.local'))).toBe(true)
    expect(existsSync(join(folder, '.env'))).toBe(false)
  })
})

describe('how the package manager is started', () => {
  it('hands the arguments to the program, not to a shell', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nekolog-cli-'))
    folders.push(folder)
    const marker = join(folder, 'argument.txt')

    const code = await runnerAt(folder)(process.execPath, [
      '-e',
      "require('node:fs').writeFileSync(process.argv[1], process.argv[2])",
      marker,
      'one & two',
    ])

    expect(code).toBe(0)
    expect(await readFile(marker, 'utf8')).toBe('one & two')
  })

  it('answers with a code instead of throwing when there is no such program', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'nekolog-cli-'))
    folders.push(folder)

    await expect(runnerAt(folder)('a-program-that-is-not-installed', [])).resolves.toBe(127)
  })
})

type Received = { method: string; url: string; authorization: string; body: string }

async function withApi(
  answer: { status: number; body: unknown },
  run: (base: string) => Promise<Run>,
): Promise<{ result: Run; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.once('end', () => {
      received.push({
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        authorization: String(incoming.headers.authorization ?? ''),
        body: Buffer.concat(chunks).toString(),
      })
      outgoing.writeHead(answer.status, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify(answer.body))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port

  try {
    return { result: await run(`http://127.0.0.1:${port}`), received }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const RELEASE = {
  created: true,
  release: {
    id: 'rel_0123456789ABCDEFGHJKMNPQRS',
    version: '1.4.2',
    commit: '9f3a1c7',
    environmentId: 'env_01HZY',
    releasedAt: '2026-11-04T12:00:00.000Z',
    sourcemapCount: 0,
  },
}

const SECRET = `nekolog_sk_${'a'.repeat(32)}`
const PUBLIC = `nekolog_pk_${'b'.repeat(32)}`

describe('recording a release, as it ships', () => {
  it('posts the version over real http and prints what came back', async () => {
    const { result, received } = await withApi({ status: 201, body: RELEASE }, (base) =>
      run(['releases', 'create', '1.4.2', '--key', SECRET, '--commit', '9f3a1c7', '--api', base]),
    )

    expect(result.code, result.err).toBe(0)
    expect(received).toHaveLength(1)
    expect(received[0]?.method).toBe('POST')
    expect(received[0]?.url).toBe('/v1/releases')
    expect(received[0]?.authorization).toBe(`Bearer ${SECRET}`)
    expect(JSON.parse(received[0]?.body ?? '{}')).toEqual({
      version: '1.4.2',
      commit: '9f3a1c7',
    })
    expect(result.out).toContain('recorded 1.4.2')
    expect(result.out).toContain('rel_0123456789ABCDEFGHJKMNPQRS')
    expect(result.out).not.toContain(SECRET)
  })

  it('reads the key from the environment the way a CI job would', async () => {
    const received: Received[] = []
    const server = createServer((incoming, outgoing) => {
      received.push({
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        authorization: String(incoming.headers.authorization ?? ''),
        body: '',
      })
      outgoing.writeHead(201, { 'content-type': 'application/json' })
      outgoing.end(JSON.stringify(RELEASE))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port

    const result = await new Promise<Run>((settle) => {
      const child = spawn(
        process.execPath,
        [CLI, 'releases', 'create', '1.4.2', '--api', `http://127.0.0.1:${port}`],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NEKOLOG_KEY: SECRET },
        },
      )
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        err += chunk.toString()
      })
      child.once('exit', (code) => settle({ code: code ?? 1, out, err }))
    })

    await new Promise<void>((resolve) => server.close(() => resolve()))

    expect(result.code, result.err).toBe(0)
    expect(received[0]?.authorization).toBe(`Bearer ${SECRET}`)
  })

  it('refuses a public key without sending anything at all', async () => {
    const { result, received } = await withApi({ status: 201, body: RELEASE }, (base) =>
      run(['releases', 'create', '1.4.2', '--key', PUBLIC, '--api', base]),
    )

    expect(result.code).toBe(1)
    expect(received).toHaveLength(0)
    expect(result.err).toContain('public key')
  })

  it('refuses to send the key in the clear to another machine', async () => {
    const result = await run([
      'releases',
      'create',
      '1.4.2',
      '--key',
      SECRET,
      '--api',
      'http://api.example.test',
    ])

    expect(result.code).toBe(1)
    expect(result.err).toContain('travel in the clear')
  })

  it('repeats what the server refused, and exits non-zero', async () => {
    const { result } = await withApi(
      {
        status: 403,
        body: { error: { code: 'insufficient_scope', message: 'This key cannot write' } },
      },
      (base) => run(['releases', 'create', '1.4.2', '--key', SECRET, '--api', base]),
    )

    expect(result.code).toBe(1)
    expect(result.err).toContain('insufficient_scope')
    expect(result.err).not.toContain(SECRET)
  })

  it('prints the usage when the subcommand is not one it has', async () => {
    const result = await run(['releases', 'nope'])

    expect(result.code).toBe(1)
    expect(result.out).toContain('nekolog releases create')
  })
})
