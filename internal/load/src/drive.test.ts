import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBatch } from '@internal/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { API_P95_MS, INGEST_P95_MS, MAX_FAILURE_RATE, MIN_CHECK_RATE } from './budget.ts'
import { DEFAULT_SERVICE } from './corpus.ts'
import { FIXTURE_FILE, type Fixture, k6EnvFor, main, writeFixture } from './drive.ts'

const folders: string[] = []

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true })
  }
})

async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'nekolog-load-'))
  folders.push(made)
  return made
}

function fixture(over: Partial<Fixture> = {}): Fixture {
  return { bytes: 1, batchId: '01933b9e-7c1a-7d4f-9a51-3f0f6c2e8b10', service: 'x', ...over }
}

describe('the fixture k6 opens', () => {
  it('is a batch the real parser accepts', async () => {
    const where = await folder()
    const written = await writeFixture(50, undefined, where)
    const parsed = parseBatch(JSON.parse(await readFile(join(where, FIXTURE_FILE), 'utf8')))

    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true)
    expect(parsed.ok && parsed.batch.accepted).toHaveLength(50)
    expect(written.service).toBe(DEFAULT_SERVICE)
  })

  it('calls itself whatever the run asked, so one run can be counted apart', async () => {
    const where = await folder()
    const written = await writeFixture(5, 'load-run-9', where)
    const onDisk = JSON.parse(await readFile(join(where, FIXTURE_FILE), 'utf8'))

    expect(written.service).toBe('load-run-9')
    expect(onDisk.resource.service).toBe('load-run-9')
  })

  it('reports the batch id it actually wrote, which k6 has to replace', async () => {
    const where = await folder()
    const written = await writeFixture(5, undefined, where)
    const onDisk = await readFile(join(where, FIXTURE_FILE), 'utf8')

    expect(written.batchId).not.toBe('')
    expect(onDisk).toContain(written.batchId)
  })
})

describe('driving one run end to end', () => {
  const ok = async () => new Response('{"status":"ok"}', { status: 200 })

  async function drive(argv: string[]) {
    const where = await folder()
    const calls: Array<{ file: string; args: readonly string[] }> = []
    const code = await main(argv, {
      probe: ok as unknown as typeof fetch,
      fixturesDir: where,
      run: async (file, args) => {
        calls.push({ file, args })
        return 0
      },
    })
    return { code, calls, where }
  }

  it('writes the fixture the run asked for and tells k6 its batch id', async () => {
    const { code, calls, where } = await drive([
      'ingest',
      '--key',
      'nekolog_sk_x',
      '--url',
      'http://localhost:8787',
      '--events',
      '25',
      '--service',
      'load-run-2',
      '--runner',
      'docker',
    ])

    expect(code).toBe(0)
    const onDisk = JSON.parse(await readFile(join(where, FIXTURE_FILE), 'utf8'))
    expect(onDisk.resource.service).toBe('load-run-2')
    expect(onDisk.events).toHaveLength(25)

    const args = calls[0]?.args ?? []
    expect(args).toContain(`-e`)
    expect(args.join(' ')).toContain(`FIXTURE_BATCH_ID=${onDisk.batchId}`)
    expect(args.join(' ')).toContain('TARGET_URL=http://host.docker.internal:8787')
  })

  it('never starts k6 when nothing is answering', async () => {
    const calls: string[] = []
    const code = await main(['ingest', '--key', 'k'], {
      probe: (async () => {
        throw new Error('ECONNREFUSED')
      }) as unknown as typeof fetch,
      run: async (file) => {
        calls.push(file)
        return 0
      },
    })

    expect(code).toBe(1)
    expect(calls).toEqual([])
  })

  it('never starts k6 without a key', async () => {
    const calls: string[] = []
    const previous = process.env.NEKOLOG_KEY
    process.env.NEKOLOG_KEY = ''
    try {
      const code = await main(['ingest'], {
        probe: ok as unknown as typeof fetch,
        run: async (file) => {
          calls.push(file)
          return 0
        },
      })

      expect(code).toBe(1)
      expect(calls).toEqual([])
    } finally {
      if (previous === undefined) {
        process.env.NEKOLOG_KEY = undefined
      } else {
        process.env.NEKOLOG_KEY = previous
      }
    }
  })

  it('prints the usage and succeeds when nobody asked for anything', async () => {
    expect(await main([])).toBe(0)
    expect(await main(['--help'])).toBe(0)
    expect(await main(['nonsense'])).toBe(1)
  })

  it('hands back whatever k6 exited with, so a crossed threshold fails the run', async () => {
    const code = await main(['api', '--key', 'nekolog_sk_x', '--url', 'http://localhost:8789'], {
      probe: ok as unknown as typeof fetch,
      run: async () => 99,
    })

    expect(code).toBe(99)
  })
})

describe('what k6 is told', () => {
  it('hands over the fixture batch id, or every batch dedupes into the first', () => {
    const env = k6EnvFor({
      target: 'ingest',
      url: 'http://localhost:8787',
      key: 'nekolog_sk_x',
      vus: '10',
      duration: '30s',
      events: 200,
      fixture: fixture({ batchId: 'the-one-in-the-file' }),
    })

    expect(env.FIXTURE_BATCH_ID).toBe('the-one-in-the-file')
    expect(env.EVENTS).toBe('200')
  })

  it('carries the thresholds of the target it is about to drive', () => {
    const common = {
      url: 'http://localhost:1',
      key: 'k',
      vus: '1',
      duration: '1s',
      events: 1,
      fixture: fixture(),
    }

    expect(k6EnvFor({ ...common, target: 'ingest' }).P95_MS).toBe(String(INGEST_P95_MS))
    expect(k6EnvFor({ ...common, target: 'api' }).P95_MS).toBe(String(API_P95_MS))
    expect(k6EnvFor({ ...common, target: 'api' })).toMatchObject({
      FAILURE_RATE: String(MAX_FAILURE_RATE),
      CHECK_RATE: String(MIN_CHECK_RATE),
    })
  })

  it('names every variable the scripts read, and nothing is blank', () => {
    const env = k6EnvFor({
      target: 'ingest',
      url: 'http://localhost:8787',
      key: 'nekolog_sk_x',
      vus: '10',
      duration: '30s',
      events: 200,
      fixture: fixture(),
    })

    for (const name of [
      'TARGET_URL',
      'NEKOLOG_KEY',
      'VUS',
      'DURATION',
      'EVENTS',
      'FIXTURE_BATCH_ID',
      'P95_MS',
      'FAILURE_RATE',
      'CHECK_RATE',
    ]) {
      expect(env[name], name).toBeTruthy()
    }
  })
})
