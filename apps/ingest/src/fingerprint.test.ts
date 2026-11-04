import { describe, expect, it, vi } from 'vitest'
import {
  appFrames,
  createFingerprinter,
  FINGERPRINT_VERSION,
  type FingerprintInput,
  fingerprintFor,
  fingerprintPartsFor,
  MAX_NORMALISED_CHARS,
  MAX_STACK_FRAMES,
  NO_FINGERPRINT,
  normaliseFile,
  normaliseMessage,
  parseFrame,
} from './fingerprint.ts'

const NODE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at charge (/srv/app/dist/payment.js:42:17)',
  '    at async handler (/srv/app/dist/routes/orders.js:88:5)',
  '    at async /srv/app/node_modules/express/lib/router/index.js:280:7',
  '    at node:internal/process/task_queues:95:5',
].join('\n')

const CHROME_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at charge (https://shop.test/assets/main.3f2a1c.js:1:4821)',
  '    at Object.onClick (https://shop.test/assets/vendor.9a8b7c6d.js:2:120)',
  '    at chrome-extension://abcdefghijklmnop/content.js:1:1',
].join('\n')

const FIREFOX_STACK = [
  'charge@https://shop.test/assets/main.3f2a1c.js:1:4821',
  'onClick@https://shop.test/assets/vendor.9a8b7c6d.js:2:120',
  'promise callback*start@moz-extension://1234/inject.js:9:3',
].join('\n')

const SAFARI_STACK = [
  'charge@https://shop.test/assets/main.3f2a1c.js:1:4821',
  'onClick@https://shop.test/assets/vendor.9a8b7c6d.js:2:120',
  'global code@https://shop.test/assets/main.3f2a1c.js:1:9',
].join('\n')

function errorEvent(overrides: Partial<FingerprintInput> = {}): FingerprintInput {
  return {
    level: 'error',
    message: 'Payment failed',
    service: 'checkout-api',
    error: { type: 'TypeError', message: 'Cannot read properties of undefined' },
    ...overrides,
  }
}

describe('when it runs at all', () => {
  it('leaves an ordinary log without a fingerprint', async () => {
    expect(await fingerprintFor({ level: 'info', message: 'hello', service: 'api' })).toBe(
      NO_FINGERPRINT,
    )
    expect(await fingerprintFor({ level: 'warn', message: 'careful', service: 'api' })).toBe(
      NO_FINGERPRINT,
    )
  })

  it('runs for an error level even with no error object', async () => {
    const parts = fingerprintPartsFor({ level: 'error', message: 'boom 42', service: 'api' })
    expect(parts).toEqual({ rule: 'log', parts: ['api', 'boom <n>'] })
  })

  it('runs for an event that carries an error whatever its level', async () => {
    const parts = fingerprintPartsFor({
      level: 'info',
      message: 'odd',
      service: 'api',
      error: { type: 'Error', message: 'odd' },
    })
    expect(parts?.rule).toBe('message')
  })
})

describe('the first rule that applies', () => {
  it('takes a manual fingerprint over everything else', () => {
    expect(fingerprintPartsFor(errorEvent({ fingerprint: ['checkout', 'card-declined'] }))).toEqual(
      { rule: 'manual', parts: ['checkout', 'card-declined'] },
    )
  })

  it('ignores a manual fingerprint made of blanks', () => {
    expect(fingerprintPartsFor(errorEvent({ fingerprint: ['', '  '] }))?.rule).toBe('message')
  })

  it('takes the stack when there is one with a frame of our own', () => {
    expect(
      fingerprintPartsFor(errorEvent({ error: { type: 'TypeError', stack: NODE_STACK } })),
    ).toEqual({
      rule: 'stack',
      parts: [
        'TypeError',
        'charge /srv/app/dist/payment.js',
        'async handler /srv/app/dist/routes/orders.js',
      ],
    })
  })

  it('falls back to the message when every frame is somebody else code', () => {
    const stack = [
      'Error: nope',
      '    at /srv/app/node_modules/pg/lib/client.js:1:1',
      '    at node:internal/process/task_queues:95:5',
    ].join('\n')

    expect(fingerprintPartsFor(errorEvent({ error: { type: 'Error', stack } }))?.rule).toBe(
      'message',
    )
  })
})

describe('reading a stack', () => {
  it('does not take the first line of a Chrome stack for a frame', () => {
    expect(
      parseFrame("TypeError: Cannot read properties of undefined (reading 'id')"),
    ).toMatchObject({ location: "reading 'id'" })
    expect(appFrames(CHROME_STACK)).not.toContain("reading 'id'")
  })

  it('reads the four engines', () => {
    expect(appFrames(NODE_STACK)).toEqual([
      'charge /srv/app/dist/payment.js',
      'async handler /srv/app/dist/routes/orders.js',
    ])
    expect(appFrames(CHROME_STACK)).toEqual(['/assets/main.js', '/assets/vendor.js'])
    expect(appFrames(FIREFOX_STACK)).toEqual(['/assets/main.js', '/assets/vendor.js'])
    expect(appFrames(SAFARI_STACK)).toEqual([
      '/assets/main.js',
      '/assets/vendor.js',
      '/assets/main.js',
    ])
  })

  it('groups the same error reported by Chrome and by Firefox together', async () => {
    const chrome = await fingerprintFor(
      errorEvent({ error: { type: 'TypeError', stack: CHROME_STACK } }),
    )
    const firefox = await fingerprintFor(
      errorEvent({ error: { type: 'TypeError', stack: FIREFOX_STACK } }),
    )

    expect(chrome).toBe(firefox)
    expect(chrome).not.toBe(NO_FINGERPRINT)
  })

  it('leaves out node_modules, the runtime and browser extensions', () => {
    expect(appFrames(NODE_STACK).join(' ')).not.toContain('node_modules')
    expect(appFrames(NODE_STACK).join(' ')).not.toContain('node:')
    expect(appFrames(CHROME_STACK).join(' ')).not.toContain('extension')
    expect(appFrames(FIREFOX_STACK).join(' ')).not.toContain('extension')
  })

  it('stops at five frames of our own', () => {
    const deep = Array.from(
      { length: 12 },
      (_, at) => `    at level${at} (/srv/app/dist/f${at}.js:1:1)`,
    ).join('\n')

    expect(appFrames(deep)).toHaveLength(MAX_STACK_FRAMES)
  })
})

describe('normalising a file name', () => {
  it.each([
    ['https://shop.test/assets/main.3f2a1c.js:1:4821', '/assets/main.js', true],
    ['https://shop.test/assets/vendor.12345678.chunk.js:2:1', '/assets/vendor.chunk.js', true],
    ['https://shop.test/app.js?v=3#x', '/app.js', false],
    ['/srv/app/dist/payment.js:42:17', '/srv/app/dist/payment.js', false],
    ['/srv/app/src/my.component.js:1:1', '/srv/app/src/my.component.js', false],
    ['C:\\app\\dist\\main.js:1:1', 'C:\\app\\dist\\main.js', false],
  ])('turns %s into %s', (location, file, hashed) => {
    expect(normaliseFile(location)).toEqual({ file, hashed })
  })

  it('keeps the function name for a file that is not a build artefact', () => {
    expect(appFrames('    at pay (/srv/app/src/pay.js:9:1)')).toEqual(['pay /srv/app/src/pay.js'])
  })

  it('drops the function name for a minified file, because it changes every build', () => {
    expect(appFrames('    at n (/assets/app.min.js:1:1)')).toEqual(['/assets/app.min.js'])
    expect(appFrames('    at n (/assets/app.3f2a1c.js:1:1)')).toEqual(['/assets/app.js'])
  })
})

describe('normalising a message', () => {
  it.each([
    ['Order 12345 failed', 'Order <n> failed'],
    ['Took 99.9 ms', 'Took <n> ms'],
    ['user 123e4567-e89b-42d3-a456-426614174000 missing', 'user <uuid> missing'],
    ['token deadbeefdeadbeefcafe not found', 'token <hex> not found'],
    ['mail to ada@example.com bounced', 'mail to <email> bounced'],
    ['GET https://api.shop.test/orders/42?x=1 failed', 'GET /orders/<n>?x=<n> failed'],
    ['could not find "the thing"', 'could not find <str>'],
    ["could not find 'the thing'", 'could not find <str>'],
    ['  spaced   out  ', 'spaced out'],
  ])('turns %s into %s', (message, normalised) => {
    expect(normaliseMessage(message)).toBe(normalised)
  })

  it('groups two reports of one error that differ only by the id', async () => {
    const one = await fingerprintFor(
      errorEvent({ error: { type: 'NotFound', message: 'order 1001 is gone' } }),
    )
    const two = await fingerprintFor(
      errorEvent({ error: { type: 'NotFound', message: 'order 2002 is gone' } }),
    )

    expect(one).toBe(two)
  })

  it('keeps two different errors apart', async () => {
    const one = await fingerprintFor(errorEvent({ error: { type: 'NotFound', message: 'gone' } }))
    const two = await fingerprintFor(errorEvent({ error: { type: 'Timeout', message: 'gone' } }))

    expect(one).not.toBe(two)
  })

  it('keeps a stack fingerprint apart from a message one with the same type', async () => {
    const stack = await fingerprintFor(
      errorEvent({ error: { type: 'TypeError', stack: NODE_STACK } }),
    )
    const message = await fingerprintFor(
      errorEvent({ error: { type: 'TypeError', message: 'charge /srv/app/dist/payment.js' } }),
    )

    expect(stack).not.toBe(message)
  })
})

describe('the number it writes', () => {
  it('is a decimal string that fits in a UInt64', async () => {
    const value = await fingerprintFor(errorEvent({ error: { type: 'E', message: 'boom' } }))

    expect(value).toMatch(/^\d+$/)
    expect(BigInt(value)).toBeLessThan(2n ** 64n)
    expect(BigInt(value)).toBeGreaterThan(0n)
  })

  it('never collides with the value that means no fingerprint', async () => {
    const value = await fingerprintFor(errorEvent())
    expect(value).not.toBe(NO_FINGERPRINT)
  })

  it('is the same every time, which is the whole point', async () => {
    const once = await fingerprintFor(errorEvent({ error: { type: 'E', stack: NODE_STACK } }))
    const twice = await fingerprintFor(errorEvent({ error: { type: 'E', stack: NODE_STACK } }))

    expect(once).toBe(twice)
  })

  it('carries the algorithm version, so a change does not mix old issues with new', () => {
    expect(FINGERPRINT_VERSION).toBe('fingerprint_v1')
  })

  it.each([
    ['manual', errorEvent({ fingerprint: ['checkout', 'card-declined'] }), '6830668972077158364'],
    [
      'stack',
      errorEvent({ error: { type: 'TypeError', stack: NODE_STACK } }),
      '14393523990822998532',
    ],
    [
      'message',
      errorEvent({ error: { type: 'NotFound', message: 'order 1001 is gone' } }),
      '962160488850058538',
    ],
    ['log', { level: 'error', message: 'boom 42', service: 'api' }, '10573921979396755676'],
  ])(
    'pins the %s rule to a value, so the algorithm cannot drift unnoticed',
    async (_rule, input, expected) => {
      expect(await fingerprintFor(input as FingerprintInput)).toBe(expected)
    },
  )
})

describe('text that arrives from outside', () => {
  it('only normalises the first kilobyte, which is what keeps it cheap', () => {
    const long = `head ${'x'.repeat(MAX_NORMALISED_CHARS)} tail`

    expect(normaliseMessage(long)).toContain('head')
    expect(normaliseMessage(long)).not.toContain('tail')
  })

  it('normalises seven hostile messages of sixteen kilobytes in a few milliseconds', () => {
    const hostile = [
      `${'a'.repeat(16_000)}!`,
      `${'1'.repeat(8_000)}.${'2'.repeat(8_000)}`,
      `"${'x'.repeat(16_000)}`,
      `${'https://a/'.repeat(1_600)}`,
      `${'a@'.repeat(8_000)}b.com`,
      `${'0123456789abcdef'.repeat(1_000)}`,
      ' '.repeat(16_000),
    ]

    const began = performance.now()
    for (const message of hostile) {
      normaliseMessage(message)
    }
    const took = performance.now() - began

    expect(took).toBeLessThan(20)
  })

  it('reads a stack of nothing but noise without falling over', () => {
    expect(() => appFrames('\u0000\n(((\n@@@\nat at at\n'.repeat(50))).not.toThrow()
  })
})

describe('the per-batch fingerprinter', () => {
  const ERROR: FingerprintInput = {
    level: 'error',
    message: 'order resolution failed',
    service: 'checkout-api',
    error: { type: 'TypeError', message: 'cannot read id', stack: NODE_STACK },
  }

  it('answers exactly what the one-shot function answers', async () => {
    const fingerprint = createFingerprinter()

    expect(await fingerprint(ERROR)).toBe(await fingerprintFor(ERROR))
    expect(await fingerprint({ level: 'info', message: 'hello', service: 'api' })).toBe(
      NO_FINGERPRINT,
    )
  })

  it('hashes one repeated error once, which is the shape a burst has', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const fingerprint = createFingerprinter()
      const answers = await Promise.all(Array.from({ length: 50 }, () => fingerprint(ERROR)))

      expect(new Set(answers).size).toBe(1)
      expect(digest).toHaveBeenCalledTimes(1)
    } finally {
      digest.mockRestore()
    }
  })

  it('still hashes once per distinct error', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const fingerprint = createFingerprinter()
      const answers = await Promise.all(
        Array.from({ length: 10 }, (_, at) =>
          fingerprint({
            ...ERROR,
            error: { ...ERROR.error, stack: NODE_STACK.replace('payment.js', `pay${at}.js`) },
          }),
        ),
      )

      expect(new Set(answers).size).toBe(10)
      expect(digest).toHaveBeenCalledTimes(10)
    } finally {
      digest.mockRestore()
    }
  })

  it('never spends a digest on an event that has no fingerprint', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      const fingerprint = createFingerprinter()
      for (let at = 0; at < 100; at += 1) {
        expect(await fingerprint({ level: 'info', message: `n ${at}`, service: 'api' })).toBe(
          NO_FINGERPRINT,
        )
      }

      expect(digest).not.toHaveBeenCalled()
    } finally {
      digest.mockRestore()
    }
  })

  it('remembers inside one batch and nothing beyond it', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest')
    try {
      await createFingerprinter()(ERROR)
      await createFingerprinter()(ERROR)

      expect(digest).toHaveBeenCalledTimes(2)
    } finally {
      digest.mockRestore()
    }
  })

  it('keeps two rules apart even when their parts would read the same', async () => {
    const manual = await createFingerprinter()({
      level: 'error',
      message: 'x',
      service: 'api',
      fingerprint: ['checkout-api', 'x'],
    })
    const log = await createFingerprinter()({
      level: 'error',
      message: 'x',
      service: 'checkout-api',
    })

    expect(manual).not.toBe(log)
  })
})
