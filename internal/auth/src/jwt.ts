import {
  calculateJwkThumbprint,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from 'jose'

type KeyLike = Awaited<ReturnType<typeof importPKCS8>>

export const ACCESS_TTL_SECONDS = 600
export const JWT_ALGORITHM = 'EdDSA'
export const JWT_ISSUER = 'nekolog'
export const JWT_AUDIENCE = 'nekolog-dashboard'

export type SigningKey = { kid: string; key: KeyLike }
export type VerifyingKey = { kid: string; key: KeyLike }

export type AccessClaims = { sub: string; sid: string }

async function thumbprintOf(key: KeyLike): Promise<string> {
  return calculateJwkThumbprint(await exportJWK(key), 'sha256')
}

export async function loadSigningKey(pkcs8: string): Promise<SigningKey> {
  const key = await importPKCS8(pkcs8, JWT_ALGORITHM, { extractable: true })
  return { kid: await thumbprintOf(key), key }
}

export async function loadVerifyingKey(spki: string): Promise<VerifyingKey> {
  const key = await importSPKI(spki, JWT_ALGORITHM, { extractable: true })
  return { kid: await thumbprintOf(key), key }
}

export async function signAccessToken(
  signing: SigningKey,
  claims: AccessClaims,
  ttlSeconds: number = ACCESS_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid: signing.kid })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signing.key)
}

export function kidOf(token: string): string | undefined {
  const header = token.split('.')[0]
  if (!header) {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    const kid = (parsed as { kid?: unknown }).kid
    return typeof kid === 'string' ? kid : undefined
  } catch {
    return undefined
  }
}

export async function verifyAccessToken(
  keys: ReadonlyArray<VerifyingKey>,
  token: string,
): Promise<AccessClaims | undefined> {
  const kid = kidOf(token)
  const key = keys.find((candidate) => candidate.kid === kid)
  if (!key) {
    return undefined
  }

  try {
    const { payload } = await jwtVerify(token, key.key, {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })

    const sub = payload.sub
    const sid = payload.sid
    if (typeof sub !== 'string' || typeof sid !== 'string') {
      return undefined
    }
    return { sub, sid }
  } catch {
    return undefined
  }
}
