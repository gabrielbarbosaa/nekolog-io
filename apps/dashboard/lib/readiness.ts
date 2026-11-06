import 'server-only'
import { signingKey, verifyingKeys } from './keys'

export const AUTH_KEYS = 'auth_keys'

export type Readiness = { ready: true } | { ready: false; problem: string; detail: string }

export const CANNOT_SIGN_ANYONE_IN =
  'AUTH_JWT_PRIVATE_KEY and AUTH_JWT_PUBLIC_KEY do not load as an Ed25519 pair, so nobody can ' +
  'sign in. Run `pnpm dev:env` to generate one, then restart this process — a server that was ' +
  'already running keeps the environment it started with.'

export async function readiness(): Promise<Readiness> {
  try {
    await signingKey()
    await verifyingKeys()
  } catch {
    return { ready: false, problem: AUTH_KEYS, detail: CANNOT_SIGN_ANYONE_IN }
  }
  return { ready: true }
}
