import 'server-only'
import { type AccessClaims, DEMO_IS_READ_ONLY, justLooking } from '@internal/auth'
import type { NextResponse } from 'next/server'
import { loginDeps } from './auth'
import { refusal } from './guard'
import { liveSession } from './session'

export type NotTheDemo = { claims: AccessClaims } | { refused: NextResponse }

export async function notTheDemo(request: Request): Promise<NotTheDemo> {
  const claims = await liveSession(request)
  if (claims === undefined) {
    return { refused: refusal('signed_out', 401) }
  }

  if (await justLooking(loginDeps().run, claims.sub)) {
    return { refused: refusal(DEMO_IS_READ_ONLY, 403) }
  }

  return { claims }
}
