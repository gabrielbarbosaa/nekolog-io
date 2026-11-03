import { describe, expect, it } from 'vitest'
import { inlineAssets, scriptTags, sha256 } from './inline.ts'

describe('inlineAssets', () => {
  it('finds a script written into the page and reads its nonce', () => {
    const [asset] = inlineAssets('<script nonce="abc">alert(1)</script>')

    expect(asset).toMatchObject({ kind: 'script', content: 'alert(1)', nonce: 'abc' })
  })

  it('does not call a script with a src inline, because no hash covers it', () => {
    expect(inlineAssets('<script src="/a.js"></script>')).toEqual([])
  })

  it('reads a nonce written with single quotes', () => {
    expect(inlineAssets("<script nonce='abc'>x</script>")[0]?.nonce).toBe('abc')
  })

  it('says a script without a nonce has none, instead of guessing one', () => {
    expect(inlineAssets('<script>x</script>')[0]?.nonce).toBeNull()
  })

  it('finds styles as well as scripts', () => {
    const kinds = inlineAssets('<style>a{}</style><script>b</script>').map((asset) => asset.kind)

    expect(kinds).toEqual(['script', 'style'])
  })

  it('ignores an element whose name merely starts the same way', () => {
    expect(inlineAssets('<scripting>x</scripting>')).toEqual([])
  })

  it('ignores an empty element, which has nothing to hash', () => {
    expect(inlineAssets('<script></script><style>  </style>')).toEqual([])
  })

  it('finds every one of several, not only the first', () => {
    expect(inlineAssets('<script>a</script><p>x</p><script>b</script>')).toHaveLength(2)
  })

  it('does not run away on an element nobody closed', () => {
    expect(inlineAssets('<script>a')).toEqual([])
  })
})

describe('scriptTags', () => {
  it('reports the src and the nonce of each tag, inline or not', () => {
    expect(
      scriptTags('<script src="/a.js" nonce="n"></script><script nonce="n">x</script>'),
    ).toEqual([
      { src: '/a.js', nonce: 'n' },
      { src: null, nonce: 'n' },
    ])
  })

  it('reports a tag that carries no nonce, which strict-dynamic would block', () => {
    expect(scriptTags('<script src="/a.js"></script>')[0]?.nonce).toBeNull()
  })
})

async function webCryptoDigest(content: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

describe('sha256', () => {
  it.each(['alert(1)', '\n\tconst a = `crase`\n', 'acentuação e emoji 🐈'])(
    'agrees with Web Crypto, which is the digest the browser computes, for %j',
    async (content) => {
      expect(sha256(content)).toBe(await webCryptoDigest(content))
    },
  )

  it('gives a different digest to a script that changed by one character', () => {
    expect(sha256('alert(1)')).not.toBe(sha256('alert(2)'))
  })
})
