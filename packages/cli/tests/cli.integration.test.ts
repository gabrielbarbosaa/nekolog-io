import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
