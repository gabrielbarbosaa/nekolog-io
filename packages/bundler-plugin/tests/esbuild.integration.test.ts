import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { nekologUnplugin } from '../src/plugin.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`

type Seen = { method: string; path: string; authorization: string; body: string }

let server: Server
let apiUrl: string
let seen: Seen[]
let refuse: { status: number; body: string } | null
const folders: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const path = request.url ?? ''
      seen.push({
        method: request.method ?? '',
        path,
        authorization: request.headers.authorization ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      })

      response.setHeader('content-type', 'application/json')
      if (refuse !== null && path.startsWith('/v1/sourcemaps')) {
        response.writeHead(refuse.status)
        response.end(refuse.body)
        return
      }

      if (path.startsWith('/v1/releases')) {
        response.writeHead(201)
        response.end(
          JSON.stringify({
            created: true,
            release: {
              id: 'rel_0123456789ABCDEFGHJKMNPQRS',
              version: '1.4.2',
              commit: null,
              environmentId: 'env_1',
              releasedAt: '2026-11-04T12:00:00.000Z',
              sourcemapCount: 0,
            },
          }),
        )
        return
      }

      response.writeHead(201)
      response.end(
        JSON.stringify({
          sourceMap: { name: 'app.js.map', bytes: Buffer.concat(chunks).byteLength },
          release: { sourcemapCount: seen.length - 1 },
        }),
      )
    })
  })

  await new Promise<void>((settle) => server.listen(0, '127.0.0.1', settle))
  apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((settle) => {
    server.close(() => settle())
  })
})

beforeEach(() => {
  seen = []
  refuse = null
})

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    await rm(folder, { recursive: true, force: true })
  }
})

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nekolog-bundler-'))
  folders.push(root)
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(
    join(root, 'src', 'app.js'),
    'export function total(items) { return items.reduce((sum, one) => sum + one, 0) }\n',
    'utf8',
  )
  return root
}

function run(root: string, options: Record<string, unknown>) {
  return build({
    entryPoints: [join(root, 'src', 'app.js')],
    outdir: join(root, 'dist'),
    bundle: true,
    sourcemap: true,
    format: 'esm',
    logLevel: 'silent',
    plugins: [nekologUnplugin.esbuild({ silent: true, apiUrl, ...options })],
  })
}

describe('the plugin inside a real esbuild build', () => {
  it('records the release and uploads the map esbuild just wrote', async () => {
    const root = await project()

    await run(root, { key: KEY, release: '1.4.2' })

    expect(seen.map((one) => `${one.method} ${one.path.split('?')[0]}`)).toEqual([
      'POST /v1/releases',
      'POST /v1/sourcemaps',
    ])
    expect(seen[0]?.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ version: '1.4.2' })
    expect(seen[1]?.path).toContain('release=1.4.2')
    expect(seen[1]?.path).toContain('name=app.js.map')
    expect(JSON.parse(seen[1]?.body ?? '{}')).toMatchObject({ version: 3 })
  })

  it('found the output directory on its own, without being told', async () => {
    const root = await project()

    await run(root, { key: KEY, release: '1.4.2' })

    expect(seen).toHaveLength(2)
    expect(existsSync(join(root, 'dist', 'app.js.map'))).toBe(true)
  })

  it('leaves the map on disk unless it was asked to delete it', async () => {
    const root = await project()

    await run(root, { key: KEY, release: '1.4.2', deleteAfterUpload: true })

    expect(existsSync(join(root, 'dist', 'app.js.map'))).toBe(false)
    expect(existsSync(join(root, 'dist', 'app.js'))).toBe(true)
  })

  it('builds and uploads nothing when there is no key', async () => {
    const root = await project()

    await run(root, {})

    expect(seen).toEqual([])
    expect(existsSync(join(root, 'dist', 'app.js'))).toBe(true)
  })

  it('fails the build when the API refuses the upload, rather than shipping a blind release', async () => {
    const root = await project()
    refuse = {
      status: 413,
      body: JSON.stringify({ error: { code: 'payload_too_large', message: 'that map is huge' } }),
    }

    await expect(run(root, { key: KEY, release: '1.4.2' })).rejects.toThrow(/payload_too_large/)
    expect(seen.map((one) => one.path.split('?')[0])).toEqual(['/v1/releases', '/v1/sourcemaps'])
  })

  it('keeps the map when the upload was refused, so a rerun still has it', async () => {
    const root = await project()
    refuse = { status: 500, body: JSON.stringify({ error: { message: 'upstream' } }) }

    await expect(
      run(root, { key: KEY, release: '1.4.2', deleteAfterUpload: true }),
    ).rejects.toThrow()
    expect(existsSync(join(root, 'dist', 'app.js.map'))).toBe(true)
  })
})
