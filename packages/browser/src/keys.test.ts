import { describe, expect, it } from 'vitest'
import { publicKeyOnly, SECRET_KEY_IN_A_BROWSER } from './keys.ts'

const PUBLIC_KEY = 'nekolog_pk_0123456789abcdef0123456789abcdef'
const SECRET_KEY = 'nekolog_sk_0123456789abcdef0123456789abcdef'

describe('which key may reach a browser', () => {
  it('takes the public key', () => {
    expect(publicKeyOnly(PUBLIC_KEY)).toEqual({ apiKey: PUBLIC_KEY })
  })

  it('refuses the secret key, which anyone reading the page would get', () => {
    expect(publicKeyOnly(SECRET_KEY)).toEqual({ refusal: SECRET_KEY_IN_A_BROWSER })
  })

  it('refuses it with surrounding whitespace too', () => {
    expect(publicKeyOnly(`  ${SECRET_KEY}\n`)).toEqual({ refusal: SECRET_KEY_IN_A_BROWSER })
  })

  it.each([undefined, null, '', '   ', 42, {}])('asks for nothing when given %j', (value) => {
    expect(publicKeyOnly(value)).toEqual({})
  })
})
