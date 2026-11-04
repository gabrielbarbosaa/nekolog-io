import { resolve } from 'node:path'
import { ReleaseRefused } from '@nekolog-io/cli'
import type { UnpluginContextMeta, UnpluginOptions } from 'unplugin'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Environment, NekologPluginOptions, ResolvedUpload } from './options.ts'
import { createNekologFactory, type FactoryDeps, nekologUnplugin, PLUGIN_NAME } from './plugin.ts'
import type { PublishReport } from './publish.ts'

const KEY = `nekolog_sk_${'a'.repeat(32)}`
const META = { framework: 'rollup' } as UnpluginContextMeta

type AnyFn = (...args: unknown[]) => unknown

function hook(value: unknown): AnyFn {
  if (typeof value !== 'function') {
    throw new Error('that hook is not a function')
  }
  return value as AnyFn
}

let published: Array<{ upload: ResolvedUpload; outDir: string | undefined }>
let notes: string[]

function deps(env: Environment): FactoryDeps {
  return {
    env,
    publish: async (upload, outDir) => {
      published.push({ upload, outDir })
      return {
        release: {
          created: true,
          release: {
            id: 'rel_0123456789ABCDEFGHJKMNPQRS',
            version: upload.release,
            commit: upload.commit,
            environmentId: 'env_1',
            releasedAt: '2026-11-04T12:00:00.000Z',
            sourcemapCount: 0,
          },
        },
        dir: outDir ?? 'dist',
        uploaded: [],
        skipped: [],
        deleted: [],
      } satisfies PublishReport
    },
    note: (line) => {
      notes.push(line)
    },
  }
}

function build(options: NekologPluginOptions = {}, env: Environment = {}): UnpluginOptions {
  return createNekologFactory(deps(env))(options, META)
}

async function finish(plugin: UnpluginOptions): Promise<void> {
  await hook(plugin.writeBundle)()
}

beforeEach(() => {
  published = []
  notes = []
})

describe('the shape of the plugin', () => {
  it('is named, and exposes every bundler unplugin covers', () => {
    expect(build().name).toBe(PLUGIN_NAME)
    for (const bundler of ['vite', 'webpack', 'rollup', 'esbuild'] as const) {
      expect(typeof nekologUnplugin[bundler], bundler).toBe('function')
    }
  })

  it('touches no module, so it cannot put the key into the bundle it is uploading for', () => {
    const plugin = build({ key: KEY, release: '1.4.2' }) as unknown as Record<string, unknown>

    for (const forbidden of ['transform', 'load', 'resolveId', 'transformInclude', 'loadInclude']) {
      expect(plugin[forbidden], forbidden).toBeUndefined()
    }
  })

  it('stays out of the dev server, which would otherwise upload on every reload', () => {
    const plugin = build({ key: KEY, release: '1.4.2' })

    expect((plugin.vite as { apply?: string } | undefined)?.apply).toBe('build')
  })

  it('runs last, so it reads a directory every other plugin has finished writing', () => {
    expect(build({ key: KEY, release: '1.4.2' }).enforce).toBe('post')
  })

  it('never throws while the config is being read, so a bad key cannot stop a dev server', () => {
    expect(() => build({ key: `nekolog_pk_${'a'.repeat(32)}`, release: '1.4.2' })).not.toThrow()
    expect(() => build({ key: KEY })).not.toThrow()
  })
})

describe('when the build ends', () => {
  it('records and uploads once, however many times the bundler writes', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })

    await finish(plugin)
    await finish(plugin)
    await finish(plugin)

    expect(published).toHaveLength(1)
    expect(published[0]?.upload).toMatchObject({ key: KEY, release: '1.4.2' })
  })

  it('does not try again after it failed, which would record the release twice', async () => {
    let tries = 0
    const failing: FactoryDeps = {
      ...deps({}),
      publish: async () => {
        tries += 1
        throw new ReleaseRefused('the API said no')
      },
    }
    const plugin = createNekologFactory(failing)({ key: KEY, release: '1.4.2' }, META)

    await expect(finish(plugin)).rejects.toThrow('the API said no')
    await finish(plugin)
    await finish(plugin)

    expect(tries).toBe(1)
  })

  it('says why it did nothing, once, when there is no key', async () => {
    const plugin = build()
    await finish(plugin)

    expect(published).toEqual([])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/^nekolog: /)
    expect(notes[0]).toContain('NEKOLOG_KEY')
  })

  it('holds its tongue when it was told to', async () => {
    await finish(build({ silent: true }))

    expect(notes).toEqual([])
  })

  it('fails the build when it has a key and the rest is wrong', async () => {
    await expect(finish(build({ key: KEY }))).rejects.toBeInstanceOf(ReleaseRefused)
    await expect(
      finish(build({ key: `nekolog_pk_${'a'.repeat(32)}`, release: '1.4.2' })),
    ).rejects.toThrow(/public key/)
  })

  it('reads the environment of the build, not of the config file', async () => {
    const plugin = build({}, { NEKOLOG_KEY: KEY, NEKOLOG_RELEASE: '9.9.9' })
    await finish(plugin)

    expect(published[0]?.upload.release).toBe('9.9.9')
  })
})

describe('finding the output directory the bundler chose', () => {
  it('learns it from Vite', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    hook((plugin.vite as Record<string, unknown>).configResolved)({
      root: resolve('/app'),
      build: { outDir: 'build/client' },
    })
    await finish(plugin)

    expect(published[0]?.outDir).toBe(resolve('/app/build/client'))
  })

  it('learns it from webpack', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    hook(plugin.webpack)({ options: { output: { path: resolve('/app/public') } } })
    await finish(plugin)

    expect(published[0]?.outDir).toBe(resolve('/app/public'))
  })

  it('learns it from Rollup', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    hook((plugin.rollup as Record<string, unknown>).outputOptions)({ dir: resolve('/app/out') })
    await finish(plugin)

    expect(published[0]?.outDir).toBe(resolve('/app/out'))
  })

  it('learns it from esbuild', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    hook((plugin.esbuild as Record<string, unknown>).config)({ outdir: resolve('/app/out') })
    await finish(plugin)

    expect(published[0]?.outDir).toBe(resolve('/app/out'))
  })

  it('keeps the first directory it was told about, not the last', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    hook((plugin.rollup as Record<string, unknown>).outputOptions)({ dir: resolve('/app/first') })
    hook((plugin.rollup as Record<string, unknown>).outputOptions)({ dir: resolve('/app/second') })
    await finish(plugin)

    expect(published[0]?.outDir).toBe(resolve('/app/first'))
  })

  it('hands over no directory at all when nothing said one, and does not guess here', async () => {
    const plugin = build({ key: KEY, release: '1.4.2' })
    await finish(plugin)

    expect(published[0]?.outDir).toBeUndefined()
  })
})
