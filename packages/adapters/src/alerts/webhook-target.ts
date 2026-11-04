export const ALLOWED_WEBHOOK_PORTS: readonly number[] = [443]
export const MAX_WEBHOOK_URL_CHARS = 2000

export class WebhookTargetError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(`Refusing this webhook address: ${reason}`)
    this.name = 'WebhookTargetError'
    this.reason = reason
  }
}

const BLOCKED_HOST_SUFFIXES: readonly string[] = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.in-addr.arpa',
  '.ip6.arpa',
]

const BLOCKED_HOSTS: readonly string[] = [
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function isPrivateIpv4(host: string): boolean {
  const match = IPV4.exec(host)
  if (match === null) {
    return false
  }

  const parts = match.slice(1).map(Number)
  if (parts.some((part) => Number.isNaN(part) || part > 255)) {
    return true
  }

  const [a = 0, b = 0] = parts

  if (a === 0 || a === 10 || a === 127) {
    return true
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  if (a === 192 && (b === 0 || b === 168)) {
    return true
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true
  }
  if (a === 192 && b === 88) {
    return true
  }
  if (a >= 224) {
    return true
  }
  return false
}

export function isPrivateIpv6(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (!bare.includes(':')) {
    return false
  }

  const lowered = bare.toLowerCase()
  if (lowered === '::' || lowered === '::1') {
    return true
  }
  if (lowered.startsWith('fe8') || lowered.startsWith('fe9') || lowered.startsWith('fea')) {
    return true
  }
  if (lowered.startsWith('feb') || lowered.startsWith('fc') || lowered.startsWith('fd')) {
    return true
  }
  if (lowered.startsWith('ff')) {
    return true
  }
  if (lowered.startsWith('::ffff:') || lowered.startsWith('64:ff9b:')) {
    return true
  }
  return false
}

export function looksLikeAnIpAddress(host: string): boolean {
  return IPV4.test(host) || host.includes(':')
}

export type WebhookUrl = {
  readonly protocol: string
  readonly hostname: string
  readonly port: string
  readonly username: string
  readonly password: string
  readonly href: string
}

type UrlConstructor = new (url: string) => WebhookUrl

export function assertWebhookTarget(value: string): WebhookUrl {
  if (value.length > MAX_WEBHOOK_URL_CHARS) {
    throw new WebhookTargetError('it is longer than an address has any reason to be')
  }

  const Url = (globalThis as { URL?: UrlConstructor }).URL
  if (Url === undefined) {
    throw new Error('This runtime has no URL, so it cannot check a webhook address')
  }

  let url: WebhookUrl
  try {
    url = new Url(value)
  } catch {
    throw new WebhookTargetError('it is not an address at all')
  }

  if (url.protocol !== 'https:') {
    throw new WebhookTargetError('only https is accepted, so the payload is never sent in clear')
  }
  if (url.username !== '' || url.password !== '') {
    throw new WebhookTargetError('it carries credentials, which belong in the channel secret')
  }

  const port = url.port === '' ? 443 : Number(url.port)
  if (!ALLOWED_WEBHOOK_PORTS.includes(port)) {
    throw new WebhookTargetError(`port ${port} is not one an https endpoint listens on`)
  }

  const host = url.hostname.toLowerCase()

  if (host === '') {
    throw new WebhookTargetError('it names no host')
  }
  if (BLOCKED_HOSTS.includes(host)) {
    throw new WebhookTargetError(`${host} is this machine or its metadata service`)
  }
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new WebhookTargetError(`${suffix} names something inside the network, not outside it`)
    }
  }
  if (looksLikeAnIpAddress(host)) {
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
      throw new WebhookTargetError(`${host} is a private or reserved address`)
    }
  } else if (!host.includes('.')) {
    throw new WebhookTargetError(`${host} has no dot, so it can only be a name on this network`)
  }

  return url
}

export function isWebhookTargetAllowed(value: string): boolean {
  try {
    assertWebhookTarget(value)
    return true
  } catch {
    return false
  }
}
