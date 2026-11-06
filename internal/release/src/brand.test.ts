import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BRAND = join(ROOT, 'docs', 'brand')

const SERVED = ['logo-dark.png', 'logo-light.png', 'icon.png']
const ORIGINALS = ['nekolog-dark.png', 'nekolog-light.png']

const COPIES: ReadonlyArray<{ where: string; files: readonly string[] }> = [
  { where: 'apps/dashboard/public', files: ['logo-dark.png', 'logo-light.png'] },
  { where: 'apps/web/public', files: ['logo-dark.png', 'logo-light.png'] },
  { where: 'apps/docs/public', files: ['logo-dark.png', 'logo-light.png', 'icon.png'] },
  { where: 'apps/dashboard/app', files: ['icon.png'] },
  { where: 'apps/web/app', files: ['icon.png'] },
]

function sizeOf(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('the mark this project puts on a screen', () => {
  it.each([...SERVED, ...ORIGINALS])('%s is in docs/brand, which is the source', (file) => {
    expect(existsSync(join(BRAND, file)), `docs/brand/${file} is missing`).toBe(true)
  })

  it.each(COPIES.flatMap(({ where, files }) => files.map((file) => ({ where, file }))))(
    '$where/$file is the same bytes as the source',
    ({ where, file }) => {
      const copy = join(ROOT, where, file)

      expect(existsSync(copy), `${where}/${file} is missing`).toBe(true)
      expect(
        readFileSync(copy).equals(readFileSync(join(BRAND, file))),
        `${where}/${file} has drifted from docs/brand/${file}`,
      ).toBe(true)
    },
  )

  it('keeps the two marks the same shape, so one can replace the other', () => {
    const dark = sizeOf(readFileSync(join(BRAND, 'logo-dark.png')))
    const light = sizeOf(readFileSync(join(BRAND, 'logo-light.png')))

    expect(light).toEqual(dark)
    expect(dark.width).toBe(256)
  })

  it('keeps the tab icon square, because a browser crops anything else', () => {
    const icon = sizeOf(readFileSync(join(BRAND, 'icon.png')))

    expect(icon.width).toBe(icon.height)
    expect(icon.width).toBe(512)
  })

  it('leaves no icon.svg behind, which a browser would prefer over the png', () => {
    for (const app of ['apps/dashboard', 'apps/web']) {
      expect(existsSync(join(ROOT, app, 'app', 'icon.svg')), `${app} still has icon.svg`).toBe(
        false,
      )
    }
  })

  it('says in its own README which mark goes on which background', () => {
    const readme = readFileSync(join(BRAND, 'README.md'), 'utf8')

    expect(readme).toContain('logo-dark.png')
    expect(readme).toContain('logo-light.png')
    expect(readme).toContain('icon.png')
  })
})
