import { dirname, resolve } from 'node:path'

function stringAt(value: unknown, ...path: string[]): string | undefined {
  let at: unknown = value
  for (const step of path) {
    if (typeof at !== 'object' || at === null) {
      return undefined
    }
    at = (at as Record<string, unknown>)[step]
  }
  return typeof at === 'string' && at.trim() !== '' ? at : undefined
}

export function viteOutDir(config: unknown): string | undefined {
  const outDir = stringAt(config, 'build', 'outDir')
  if (outDir === undefined) {
    return undefined
  }
  const root = stringAt(config, 'root')
  return root === undefined ? outDir : resolve(root, outDir)
}

export function webpackOutDir(compiler: unknown): string | undefined {
  return stringAt(compiler, 'options', 'output', 'path')
}

export function esbuildOutDir(initialOptions: unknown): string | undefined {
  const outdir = stringAt(initialOptions, 'outdir')
  if (outdir !== undefined) {
    return outdir
  }
  const outfile = stringAt(initialOptions, 'outfile')
  return outfile === undefined ? undefined : dirname(outfile)
}

export function rollupOutDir(options: unknown): string | undefined {
  const dir = stringAt(options, 'dir')
  if (dir !== undefined) {
    return dir
  }
  const file = stringAt(options, 'file')
  return file === undefined ? undefined : dirname(file)
}
