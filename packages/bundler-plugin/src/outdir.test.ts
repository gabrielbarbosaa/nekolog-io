import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { esbuildOutDir, rollupOutDir, viteOutDir, webpackOutDir } from './outdir.ts'

describe('learning where the build landed', () => {
  it('reads Vite, whose outDir is relative to the project root', () => {
    expect(viteOutDir({ root: resolve('/app'), build: { outDir: 'build/client' } })).toBe(
      resolve('/app/build/client'),
    )
    expect(viteOutDir({ root: resolve('/app'), build: { outDir: resolve('/elsewhere') } })).toBe(
      resolve('/elsewhere'),
    )
    expect(viteOutDir({ build: { outDir: 'dist' } })).toBe('dist')
  })

  it('reads webpack, whose output path is already absolute', () => {
    expect(webpackOutDir({ options: { output: { path: resolve('/app/public') } } })).toBe(
      resolve('/app/public'),
    )
  })

  it('reads esbuild, which writes either a directory or a single file', () => {
    expect(esbuildOutDir({ outdir: 'out' })).toBe('out')
    expect(esbuildOutDir({ outfile: resolve('/app/out/bundle.js') })).toBe(resolve('/app/out'))
    expect(esbuildOutDir({ outdir: 'out', outfile: resolve('/app/x/bundle.js') })).toBe('out')
  })

  it('reads Rollup, which does the same', () => {
    expect(rollupOutDir({ dir: 'out' })).toBe('out')
    expect(rollupOutDir({ file: resolve('/app/out/bundle.js') })).toBe(resolve('/app/out'))
  })

  it('says it does not know rather than inventing a path', () => {
    for (const reader of [viteOutDir, webpackOutDir, esbuildOutDir, rollupOutDir]) {
      for (const given of [undefined, null, 0, '', 'a string', [], {}, { build: {} }]) {
        expect(reader(given), `${reader.name} ${JSON.stringify(given)}`).toBeUndefined()
      }
    }
  })

  it('treats a blank value as no value, so it never deletes the project root', () => {
    expect(viteOutDir({ root: resolve('/app'), build: { outDir: '   ' } })).toBeUndefined()
    expect(webpackOutDir({ options: { output: { path: '' } } })).toBeUndefined()
    expect(esbuildOutDir({ outdir: '' })).toBeUndefined()
  })
})
