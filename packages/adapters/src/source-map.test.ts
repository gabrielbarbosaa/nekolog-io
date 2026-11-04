import { describe, expect, it } from 'vitest'
import {
  assertSourceMapBody,
  assertSourceMapName,
  headOf,
  InvalidSourceMap,
  MAX_SOURCE_MAP_BYTES,
  MAX_SOURCE_MAP_NAME_CHARS,
  SOURCE_MAP_HEAD_BYTES,
  sourceMapKey,
} from './source-map.ts'

const encoder = new TextEncoder()

function map(over: Record<string, unknown> = {}): Uint8Array {
  return encoder.encode(
    JSON.stringify({ version: 3, sources: ['src/app.ts'], mappings: 'AAAA', ...over }),
  )
}

describe('the name a source map may be stored under', () => {
  it('takes a plain file name ending in .map', () => {
    for (const name of ['app.js.map', 'index-B7f2.mjs.map', '0.map', 'a_b-c.css.map']) {
      expect(assertSourceMapName(name), name).toBe(name)
    }
  })

  it('refuses anything that could reach out of its own directory', () => {
    for (const name of [
      '../escaped.map',
      'a/b.map',
      'a\\b.map',
      '/etc/passwd.map',
      '..',
      '.',
      '.hidden.map',
      'a\u0000.map',
      'a%2e%2e.map',
      '',
    ]) {
      expect(() => assertSourceMapName(name), JSON.stringify(name)).toThrow(InvalidSourceMap)
    }
  })

  it('refuses a name that is not a map, or is too long', () => {
    expect(() => assertSourceMapName('app.js')).toThrow(/\.map/)
    expect(() => assertSourceMapName('app.map.js')).toThrow(/\.map/)
    expect(() => assertSourceMapName(`${'a'.repeat(MAX_SOURCE_MAP_NAME_CHARS)}.map`)).toThrow(
      /at most/,
    )
    expect(() => assertSourceMapName(42)).toThrow(/needs a file name/)
  })
})

describe('the body it accepts as a source map', () => {
  it('takes a version 3 map', () => {
    expect(assertSourceMapBody(map())).toMatchObject({ declaredVersion: 3 })
  })

  it('takes an index map, which has sections instead of mappings', () => {
    const sections = encoder.encode(JSON.stringify({ version: 3, sections: [] }))

    expect(assertSourceMapBody(sections)).toMatchObject({ declaredVersion: 3 })
  })

  it('refuses something that is not a map at all', () => {
    for (const body of ['', 'not json', '[]', '"a string"', '<html></html>']) {
      expect(() => assertSourceMapBody(encoder.encode(body)), body).toThrow(InvalidSourceMap)
    }
  })

  it('refuses something that holds mappings but is not an object', () => {
    for (const body of [
      JSON.stringify([{ version: 3, mappings: 'AAAA' }]),
      `// a comment\n{"version":3,"mappings":"AAAA"}`,
      `)]}'\n{"version":3,"mappings":"AAAA"}`,
      `"{\\"mappings\\":\\"AAAA\\"}"`,
    ]) {
      expect(() => assertSourceMapBody(encoder.encode(body)), body.slice(0, 20)).toThrow(
        /does not open a JSON object/,
      )
    }
  })

  it('refuses a JSON object that carries no mappings', () => {
    const plain = encoder.encode(JSON.stringify({ version: 3, hello: 'world' }))

    expect(() => assertSourceMapBody(plain)).toThrow(/no "mappings" or "sections"/)
  })

  it('refuses a version it does not understand', () => {
    expect(() => assertSourceMapBody(map({ version: 2 }))).toThrow(/version 2 source map/)
    expect(() => assertSourceMapBody(map({ version: 4 }))).toThrow(/version 4 source map/)
  })

  it('marks an oversize body as oversize, so the route can answer 413', () => {
    const huge = new Uint8Array(MAX_SOURCE_MAP_BYTES + 1).fill(0x7b)

    try {
      assertSourceMapBody(huge)
      expect.unreachable('an oversize map has to be refused')
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSourceMap)
      expect((error as InvalidSourceMap).oversize).toBe(true)
    }

    expect(
      (() => {
        try {
          assertSourceMapBody(encoder.encode('nope'))
        } catch (error) {
          return (error as InvalidSourceMap).oversize
        }
        return null
      })(),
    ).toBe(false)
  })

  it('only reads the head, because parsing megabytes does not fit a Worker', () => {
    const head = `{"version":3,"mappings":"AAAA","sourcesContent":["${'x'.repeat(200_000)}"]}`
    const body = encoder.encode(head)

    expect(body.length).toBeGreaterThan(SOURCE_MAP_HEAD_BYTES)
    expect(headOf(body).length).toBe(SOURCE_MAP_HEAD_BYTES)
    expect(assertSourceMapBody(body).bytes).toBe(body.length)
  })

  it('takes a map that opens with a byte order mark, which Windows tooling writes', () => {
    const plain = map()
    const marked = new Uint8Array(plain.length + 3)
    marked.set([0xef, 0xbb, 0xbf], 0)
    marked.set(plain, 3)

    expect(assertSourceMapBody(marked)).toMatchObject({ declaredVersion: 3, bytes: marked.length })
    expect(headOf(marked).charAt(0)).toBe('{')
  })

  it('reads an ASCII key out of a head that holds multi-byte characters', () => {
    const body = encoder.encode(
      JSON.stringify({ version: 3, file: 'café—ok', sources: ['á'], mappings: 'AAAA' }),
    )

    expect(() => assertSourceMapBody(body)).not.toThrow()
  })
})

describe('the key a source map is stored under', () => {
  it('is the project, the release and the name, in that order', () => {
    expect(sourceMapKey('prj_1', 'rel_2', 'app.js.map')).toBe('sourcemaps/prj_1/rel_2/app.js.map')
  })

  it('refuses an id that could become a path of its own', () => {
    for (const bad of ['../x', 'a/b', '', '.', 'a b']) {
      expect(() => sourceMapKey(bad, 'rel_2', 'app.js.map'), bad).toThrow(InvalidSourceMap)
      expect(() => sourceMapKey('prj_1', bad, 'app.js.map'), bad).toThrow(InvalidSourceMap)
    }
  })

  it('refuses the name through the same gate', () => {
    expect(() => sourceMapKey('prj_1', 'rel_2', '../escape.map')).toThrow(InvalidSourceMap)
  })
})
