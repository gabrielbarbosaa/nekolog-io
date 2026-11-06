import { newNonce, nonceSource, securityHeaders } from '@internal/security-headers'
import { type NextRequest, NextResponse } from 'next/server'
import { NONCE_HEADER } from './lib/nonce'

export function proxy(request: NextRequest) {
  const nonce = newNonce()
  const headers = securityHeaders({
    scriptSources: [nonceSource(nonce)],
    styleSources: [nonceSource(nonce)],
    strictDynamic: true,
  })

  const forwarded = new Headers(request.headers)
  forwarded.set(NONCE_HEADER, nonce)

  const response = NextResponse.next({ request: { headers: forwarded } })
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
