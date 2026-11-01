import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

type Run = {
  code: number
  stdout: string
  stderr: string
}

function run(script: string, args: string[], input?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(PACKAGE, 'src', script), ...args], {
      cwd: PACKAGE,
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }))
    child.stdin.end(input ?? '')
  })
}

const OPEN = '${'

function slot(name: string): string {
  return `${OPEN}${name}}`
}

const CONFIG = {
  name: 'nekolog-ingest',
  main: 'src/worker.ts',
  env: {
    dev: {
      name: 'nekolog-ingest-dev',
      kv_namespaces: [{ binding: 'KEYS', id: slot('KV_NAMESPACE_ID') }],
      vars: { CLICKHOUSE_DB: 'nekolog_dev' },
    },
    prod: {
      name: 'nekolog-ingest-prod',
      kv_namespaces: [{ binding: 'KEYS', id: slot('KV_NAMESPACE_ID') }],
      vars: { CLICKHOUSE_DB: 'nekolog_prod' },
    },
  },
}

let workspace: string
let configPath: string
let manifestPath: string

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'nekolog-deploy-'))
  configPath = join(workspace, 'wrangler.json')
  manifestPath = join(workspace, 'secrets.json')
  writeFileSync(configPath, JSON.stringify(CONFIG), 'utf8')
  writeFileSync(manifestPath, JSON.stringify({ ingest: ['A_PASSWORD', 'B_ID'] }), 'utf8')
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('render-cli, which is what the deploy workflow runs', () => {
  it('writes a configuration holding only the environment asked for', async () => {
    const out = join(workspace, 'rendered.json')
    process.env.KV_NAMESPACE_ID = '8f2c'

    const result = await run('render-cli.ts', [
      '--config',
      configPath,
      '--environment',
      'dev',
      '--out',
      out,
    ])

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      name: 'nekolog-ingest',
      main: 'src/worker.ts',
      env: {
        dev: {
          name: 'nekolog-ingest-dev',
          kv_namespaces: [{ binding: 'KEYS', id: '8f2c' }],
          vars: { CLICKHOUSE_DB: 'nekolog_dev' },
        },
      },
    })
  })

  it('fails, saying what is missing, instead of writing a Worker without bindings', async () => {
    const out = join(workspace, 'never-written.json')
    delete process.env.KV_NAMESPACE_ID

    const result = await run('render-cli.ts', [
      '--config',
      configPath,
      '--environment',
      'dev',
      '--out',
      out,
    ])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('KV_NAMESPACE_ID')
    expect(() => readFileSync(out, 'utf8')).toThrow()
  })
})

describe('secrets-cli, which never prints a value', () => {
  it('picks the secrets the app declared out of everything the runner has', async () => {
    const out = join(workspace, 'secrets-out.json')

    const result = await run(
      'secrets-cli.ts',
      ['--app', 'ingest', '--out', out, '--manifest', manifestPath],
      JSON.stringify({ A_PASSWORD: 'one', B_ID: 'two', UNRELATED: 'three' }),
    )

    expect(result.stderr).toBe('')
    expect(result.code).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({ A_PASSWORD: 'one', B_ID: 'two' })
  })

  it('fails naming the secret that is not set, and shows no value anywhere', async () => {
    const out = join(workspace, 'secrets-missing.json')

    const result = await run(
      'secrets-cli.ts',
      ['--app', 'ingest', '--out', out, '--manifest', manifestPath],
      JSON.stringify({ A_PASSWORD: 'a-very-secret-value' }),
    )

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('B_ID')
    expect(`${result.stdout}${result.stderr}`).not.toContain('a-very-secret-value')
  })

  it('does not echo the input when the input is not JSON at all', async () => {
    const out = join(workspace, 'secrets-broken.json')

    const result = await run(
      'secrets-cli.ts',
      ['--app', 'ingest', '--out', out, '--manifest', manifestPath],
      'a-very-secret-value',
    )

    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).not.toContain('a-very-secret-value')
  })

  it('does not echo the input when the input is JSON but not an object', async () => {
    const out = join(workspace, 'secrets-not-an-object.json')

    const result = await run(
      'secrets-cli.ts',
      ['--app', 'ingest', '--out', out, '--manifest', manifestPath],
      JSON.stringify(['a-very-secret-value']),
    )

    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).not.toContain('a-very-secret-value')
  })
})
