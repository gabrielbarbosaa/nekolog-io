import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from 'unplugin'
import type { Environment, NekologPluginOptions, ResolvedUpload } from './options.ts'
import { resolveOptions } from './options.ts'
import { esbuildOutDir, rollupOutDir, viteOutDir, webpackOutDir } from './outdir.ts'
import { type PublishReport, publishBuild } from './publish.ts'

export const PLUGIN_NAME = 'nekolog'

export type NekologUnplugin = UnpluginInstance<NekologPluginOptions | undefined, false>

export type NekologFactory = UnpluginFactory<NekologPluginOptions | undefined, false>

export type FactoryDeps = {
  env: Environment
  publish: (upload: ResolvedUpload, outDir: string | undefined) => Promise<PublishReport>
  note: (line: string) => void
}

export const defaultFactoryDeps: FactoryDeps = {
  env: process.env,
  publish: (upload, outDir) => publishBuild(upload, outDir),
  note: (line) => {
    process.stdout.write(`${line}\n`)
  },
}

export function createNekologFactory(deps: FactoryDeps): NekologFactory {
  return (raw) => {
    const options = raw ?? {}
    let outDir: string | undefined
    let published = false

    return {
      name: PLUGIN_NAME,
      enforce: 'post',
      vite: {
        apply: 'build',
        configResolved(config: unknown) {
          outDir ??= viteOutDir(config)
        },
      },
      rollup: {
        outputOptions(output: unknown) {
          outDir ??= rollupOutDir(output)
        },
      },
      webpack(compiler: unknown) {
        outDir ??= webpackOutDir(compiler)
      },
      esbuild: {
        config(building: unknown) {
          outDir ??= esbuildOutDir(building)
        },
      },
      async writeBundle() {
        if (published) {
          return
        }
        published = true

        const resolution = resolveOptions(options, deps.env)
        if (!resolution.run) {
          if (options.silent !== true) {
            deps.note(`${PLUGIN_NAME}: ${resolution.reason}`)
          }
          return
        }

        await deps.publish(resolution.upload, outDir)
      },
    }
  }
}

export const nekologFactory: NekologFactory = createNekologFactory(defaultFactoryDeps)

export const nekologUnplugin: NekologUnplugin = createUnplugin(nekologFactory)
