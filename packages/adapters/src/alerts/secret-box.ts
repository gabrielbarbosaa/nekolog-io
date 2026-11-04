export const SECRET_BOX_VERSION = 'v1'
export const SECRET_BOX_KEY_BYTES = 32
export const SECRET_BOX_NONCE_BYTES = 12
export const SIGNATURE_HEADER = 'X-NekoLog-Signature'

type OpaqueKey = { readonly __brand: 'key' }

type SubtleLike = {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: unknown,
    extractable: boolean,
    usages: readonly string[],
  ): Promise<OpaqueKey>
  encrypt(algorithm: unknown, key: OpaqueKey, data: Uint8Array): Promise<ArrayBuffer>
  decrypt(algorithm: unknown, key: OpaqueKey, data: Uint8Array): Promise<ArrayBuffer>
  sign(algorithm: unknown, key: OpaqueKey, data: Uint8Array): Promise<ArrayBuffer>
}

type CryptoLike = {
  getRandomValues?: (array: Uint8Array) => Uint8Array
  subtle?: SubtleLike
}

type TextEncoderLike = { encode(input: string): Uint8Array }
type TextDecoderLike = { decode(input: Uint8Array): string }

function webCrypto(): { subtle: SubtleLike; randomBytes: (size: number) => Uint8Array } {
  const source = (globalThis as unknown as { crypto?: CryptoLike }).crypto
  if (source?.subtle === undefined || source.getRandomValues === undefined) {
    throw new Error('This runtime has no Web Crypto, so it cannot seal a channel secret')
  }
  const ready = source as Required<Pick<CryptoLike, 'getRandomValues' | 'subtle'>>
  return {
    subtle: ready.subtle,
    randomBytes: (size) => ready.getRandomValues(new Uint8Array(size)),
  }
}

function encodeUtf8(value: string): Uint8Array {
  const Encoder = (globalThis as { TextEncoder?: new () => TextEncoderLike }).TextEncoder
  if (!Encoder) {
    throw new Error('This runtime has no TextEncoder, so it cannot seal a channel secret')
  }
  return new Encoder().encode(value)
}

function decodeUtf8(value: Uint8Array): string {
  const Decoder = (globalThis as { TextDecoder?: new () => TextDecoderLike }).TextDecoder
  if (!Decoder) {
    throw new Error('This runtime has no TextDecoder, so it cannot open a channel secret')
  }
  return new Decoder().decode(value)
}

export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

export function fromHex(value: string): Uint8Array {
  if (value.length % 2 !== 0 || !/^[0-9a-f]*$/.test(value)) {
    throw new Error('Expected lowercase hexadecimal with an even number of characters')
  }
  const bytes = new Uint8Array(value.length / 2)
  for (let at = 0; at < bytes.length; at += 1) {
    bytes[at] = Number.parseInt(value.slice(at * 2, at * 2 + 2), 16)
  }
  return bytes
}

export function secretKeyBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      `A channel secret key is ${SECRET_BOX_KEY_BYTES} bytes written as 64 lowercase hex characters`,
    )
  }
  return fromHex(value)
}

async function keyFor(
  keyMaterial: string,
  algorithm: unknown,
  usages: readonly string[],
): Promise<OpaqueKey> {
  return webCrypto().subtle.importKey('raw', secretKeyBytes(keyMaterial), algorithm, false, usages)
}

export async function sealSecret(
  plaintext: string,
  keyMaterial: string,
  context: string,
): Promise<string> {
  if (plaintext === '') {
    throw new Error('Refusing to seal an empty channel secret')
  }
  if (context === '') {
    throw new Error('Refusing to seal a channel secret with no context to bind it to')
  }

  const { subtle, randomBytes } = webCrypto()
  const key = await keyFor(keyMaterial, { name: 'AES-GCM' }, ['encrypt', 'decrypt'])
  const nonce = randomBytes(SECRET_BOX_NONCE_BYTES)

  const sealed = await subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: encodeUtf8(context) },
    key,
    encodeUtf8(plaintext),
  )

  return `${SECRET_BOX_VERSION}.${toHex(nonce)}.${toHex(new Uint8Array(sealed))}`
}

export async function openSecret(
  sealed: string,
  keyMaterial: string,
  context: string,
): Promise<string> {
  const parts = sealed.split('.')
  if (parts.length !== 3 || parts[0] !== SECRET_BOX_VERSION) {
    throw new Error('This channel secret was not sealed by a version this build understands')
  }

  const { subtle } = webCrypto()
  const key = await keyFor(keyMaterial, { name: 'AES-GCM' }, ['encrypt', 'decrypt'])

  let opened: ArrayBuffer
  try {
    opened = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromHex(parts[1] as string),
        additionalData: encodeUtf8(context),
      },
      key,
      fromHex(parts[2] as string),
    )
  } catch {
    throw new Error('This channel secret did not open; the key, the context or the bytes changed')
  }

  return decodeUtf8(new Uint8Array(opened))
}

export function newChannelSecret(): string {
  return toHex(webCrypto().randomBytes(SECRET_BOX_KEY_BYTES))
}

export async function signPayload(body: string, keyMaterial: string): Promise<string> {
  const { subtle } = webCrypto()
  const key = await keyFor(keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, ['sign'])
  const signed = await subtle.sign('HMAC', key, encodeUtf8(body))
  return `sha256=${toHex(new Uint8Array(signed))}`
}
