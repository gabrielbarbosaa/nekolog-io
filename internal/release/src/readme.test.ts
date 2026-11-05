import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const READMES = ['README.md', 'README.pt-BR.md', 'README.es.md']
const COMMUNITY = ['LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md']

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g

function read(file: string): string {
  return readFileSync(join(ROOT, file), 'utf8')
}

function relativeLinksIn(text: string): string[] {
  return [...text.matchAll(LINK)]
    .map((match) => match[1] as string)
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split('#')[0] as string)
    .filter((target) => target !== '')
}

describe('the files a stranger lands on', () => {
  it('are all there, because the README links to every one of them', () => {
    for (const file of [...READMES, ...COMMUNITY]) {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true)
    }
  })

  it('link only to paths that exist in this repository', () => {
    const broken: string[] = []

    for (const file of [...READMES, 'CONTRIBUTING.md']) {
      const links = relativeLinksIn(read(file))
      expect(links.length, `${file} has no relative links, so this proved nothing`).toBeGreaterThan(
        5,
      )
      for (const target of links) {
        if (!existsSync(join(ROOT, target))) {
          broken.push(`${file} → ${target}`)
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('point at each other, so a reader can get to their own language', () => {
    expect(read('README.md')).toContain('README.pt-BR.md')
    expect(read('README.md')).toContain('README.es.md')
    expect(read('README.pt-BR.md')).toContain('README.md')
    expect(read('README.es.md')).toContain('README.md')
  })

  it('say the same thing about what is not published yet, in every language', () => {
    for (const file of READMES) {
      const text = read(file)

      expect(text.toLowerCase(), `${file} does not mention npm`).toContain('npm')
      expect(text, `${file} does not say which version this is`).toContain('1.0')
    }
  })

  it('each say, in their own language, that there is no hosted service', () => {
    const said: Record<string, string> = {
      'README.md': 'there is no hosted service',
      'README.pt-BR.md': 'não existe serviço hospedado',
      'README.es.md': 'no hay servicio alojado',
    }

    for (const [file, sentence] of Object.entries(said)) {
      expect(read(file).toLowerCase(), `${file} drops the caveat`).toContain(sentence)
    }
  })

  it('all send the reader to the one thing that does work today', () => {
    for (const file of READMES) {
      expect(read(file), `${file} does not show how to run it`).toContain('deploy/self-host')
    }
  })
})
