export class WebhookRefused extends Error {
  constructor(reason: string) {
    super(`Refusing this webhook: ${reason}`)
    this.name = 'WebhookRefused'
  }
}

export const WEBHOOK_TOLERANCE_SECONDS: number = 300

const SECRET_PREFIX = 'whsec_'
const VERSION = 'v1,'

export type WebhookHeaders = {
  get(name: string): string | null
}

export type VerifyOptions = {
  secret: string
  headers: WebhookHeaders
  body: string
  now?: Date
  toleranceSeconds?: number
}

function required(headers: WebhookHeaders, name: string): string {
  const value = headers.get(name)
  if (value === null || value.trim() === '') {
    throw new WebhookRefused(`it carries no ${name}`)
  }
  return value
}

type HmacKey = { readonly brand: unique symbol }

type SubtleLike = {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: boolean,
    usages: string[],
  ): Promise<HmacKey>
  sign(algorithm: 'HMAC', key: HmacKey, data: Uint8Array): Promise<ArrayBuffer>
}

type Ambient = {
  crypto?: { subtle?: SubtleLike }
  TextEncoder?: new () => { encode(input: string): Uint8Array }
  atob?: (value: string) => string
  btoa?: (value: string) => string
}

function ambient(): Ambient {
  return globalThis as unknown as Ambient
}

function missing(what: string): never {
  throw new WebhookRefused(`this runtime has no ${what}, so no signature can be checked`)
}

function fromBase64(value: string): Uint8Array {
  const decode = ambient().atob ?? missing('atob')
  return Uint8Array.from(decode(value), (character: string) => character.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  const encode = ambient().btoa ?? missing('btoa')
  return encode(String.fromCharCode(...bytes))
}

function decodeSecret(secret: string): Uint8Array {
  const raw = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret
  if (raw === '') {
    throw new WebhookRefused('the signing secret is empty')
  }
  return fromBase64(raw)
}

function sameBytes(one: string, other: string): boolean {
  if (one.length !== other.length) {
    return false
  }
  let different = 0
  for (let index = 0; index < one.length; index += 1) {
    different |= one.charCodeAt(index) ^ other.charCodeAt(index)
  }
  return different === 0
}

async function sign(secret: Uint8Array, content: string): Promise<string> {
  const subtle = ambient().crypto?.subtle ?? missing('crypto.subtle')
  const Encoder = ambient().TextEncoder ?? missing('TextEncoder')

  const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await subtle.sign('HMAC', key, new Encoder().encode(content))
  return toBase64(new Uint8Array(signature))
}

export async function verifyWebhook(options: VerifyOptions): Promise<void> {
  const id = required(options.headers, 'svix-id')
  const timestamp = required(options.headers, 'svix-timestamp')
  const signatures = required(options.headers, 'svix-signature')

  const seconds = Number(timestamp)
  if (!Number.isInteger(seconds)) {
    throw new WebhookRefused('its timestamp is not a whole number of seconds')
  }

  const tolerance = options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (Math.abs(now - seconds) > tolerance) {
    throw new WebhookRefused('its timestamp is outside the tolerance, so it may be a replay')
  }

  const expected = await sign(decodeSecret(options.secret), `${id}.${timestamp}.${options.body}`)

  const offered = signatures
    .split(' ')
    .filter((part) => part.startsWith(VERSION))
    .map((part) => part.slice(VERSION.length))

  if (offered.length === 0) {
    throw new WebhookRefused('it carries no v1 signature')
  }

  if (!offered.some((signature) => sameBytes(signature, expected))) {
    throw new WebhookRefused('no signature on it matches the body')
  }
}
