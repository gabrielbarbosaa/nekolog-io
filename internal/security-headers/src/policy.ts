export const HSTS = 'max-age=63072000; includeSubDomains; preload'
export const REFERRER_POLICY = 'strict-origin-when-cross-origin'
export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'camera=()',
  'display-capture=()',
  'encrypted-media=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ')

const FORBIDDEN_IN_SOURCE = /[\s;,]/

export class InvalidSource extends Error {
  constructor(source: string) {
    super(
      `A CSP source may not carry a separator, a space or a line break: ${JSON.stringify(source)}`,
    )
    this.name = 'InvalidSource'
  }
}

export type PolicyOptions = {
  scriptSources?: readonly string[]
  styleSources?: readonly string[]
  connectSources?: readonly string[]
  strictDynamic?: boolean
}

function checked(sources: readonly string[]): string[] {
  for (const source of sources) {
    if (source.length === 0 || FORBIDDEN_IN_SOURCE.test(source)) {
      throw new InvalidSource(source)
    }
  }
  return [...sources]
}

export function contentSecurityPolicy(options: PolicyOptions = {}): string {
  const script = [
    "'self'",
    ...(options.strictDynamic === true ? ["'strict-dynamic'"] : []),
    ...checked(options.scriptSources ?? []),
  ]

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'none'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", ...checked(options.styleSources ?? [])]],
    ['img-src', ["'self'", 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...checked(options.connectSources ?? [])]],
    ['manifest-src', ["'self'"]],
    ['worker-src', ["'self'"]],
  ]

  return [
    ...directives.map(([name, sources]) => `${name} ${sources.join(' ')}`),
    'upgrade-insecure-requests',
  ].join('; ')
}

export function securityHeaders(options: PolicyOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(options),
    'Strict-Transport-Security': HSTS,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': REFERRER_POLICY,
    'Permissions-Policy': PERMISSIONS_POLICY,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
}

export function nonceSource(nonce: string): string {
  return `'nonce-${nonce}'`
}

export function hashSource(digest: string): string {
  return `'sha256-${digest}'`
}

export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
