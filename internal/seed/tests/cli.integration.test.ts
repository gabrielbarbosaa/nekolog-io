import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(PACKAGE, 'src', 'cli.ts')

let workspace: string
let file: string

type Run = {
  status: number
  stdout: string
  stderr: string
}

function seed(...args: string[]): Run {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PACKAGE,
    encoding: 'utf8',
    timeout: 60_000,
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const SECRET_IN_THE_CLEAR = /nekolog_(pk|sk)_[A-Za-z0-9_-]{16,}/

describe('the seed command, run the way a person runs it', () => {
  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'nekolog-seed-'))
    file = join(workspace, 'seed.json')
  })

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  it('starts up at all under plain node', () => {
    const run = seed('--help')

    expect(run.status).toBe(0)
    expect(run.stderr).toBe('')
    expect(run.stdout).toContain('pnpm seed init')
  })

  it('creates the project and prints every key once', () => {
    const run = seed('init', '--file', file, '--organization', 'ATF', '--project', 'checkout')

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('ATF')
    expect(run.stdout.match(/nekolog_pk_[A-Za-z0-9_-]{32}/g)).toHaveLength(3)
    expect(run.stdout.match(/nekolog_sk_[A-Za-z0-9_-]{32}/g)).toHaveLength(3)
  })

  it('writes a file that holds no key in the clear', () => {
    expect(readFileSync(file, 'utf8')).not.toMatch(SECRET_IN_THE_CLEAR)
  })

  it('warns that the public keys take any origin', () => {
    expect(seed('show', '--file', file).stdout).toContain('qualquer origem')
  })

  it('refuses to overwrite a seed that already exists', () => {
    const run = seed('init', '--file', file)

    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/já existe/)
    expect(run.stdout).not.toMatch(SECRET_IN_THE_CLEAR)
  })

  it('shows what exists without printing a single secret', () => {
    const run = seed('show', '--file', file)

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('production')
    expect(run.stdout).not.toMatch(SECRET_IN_THE_CLEAR)
  })

  it('adds a key to an environment that already exists', () => {
    const before = JSON.parse(readFileSync(file, 'utf8'))
    const run = seed('add-key', '--file', file, '--environment', 'staging', '--kind', 'public')
    const after = JSON.parse(readFileSync(file, 'utf8'))

    expect(run.status).toBe(0)
    expect(run.stdout).toMatch(/nekolog_pk_[A-Za-z0-9_-]{32}/)
    expect(after.environments[1].keys).toHaveLength(before.environments[1].keys.length + 1)
    expect(readFileSync(file, 'utf8')).not.toMatch(SECRET_IN_THE_CLEAR)
  })

  it('keeps the key that was already there, so rotation has no gap', () => {
    const document = JSON.parse(readFileSync(file, 'utf8'))
    const hashes = document.environments[1].keys.map((key: { hash: string }) => key.hash)

    expect(new Set(hashes).size).toBe(hashes.length)
    expect(hashes.length).toBeGreaterThan(2)
  })

  it('says which environments exist when the name is wrong', () => {
    const run = seed('add-key', '--file', file, '--environment', 'qa')

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('production, staging, development')
  })

  it('asks for an environment instead of guessing one', () => {
    expect(seed('add-key', '--file', file).status).toBe(1)
  })

  it('refuses a command it does not know', () => {
    expect(seed('destroy', '--file', file).status).toBe(1)
  })

  it('says where to start when there is no seed yet', () => {
    const run = seed('show', '--file', join(workspace, 'missing.json'))

    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/seed init/)
  })
})
