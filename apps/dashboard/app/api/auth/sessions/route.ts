import { listSessions, originAllowed, revokeOwnSession } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings } from '@/lib/auth'
import { jsonBody, stringField } from '@/lib/request'
import { liveSession, sessionStore } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const open = await listSessions(sessionStore(), claims.sub)

  return NextResponse.json({
    sessions: open.map((session) => ({ ...session, current: session.sid === claims.sid })),
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const sid = stringField(await jsonBody(request), 'sid')
  const ended = await revokeOwnSession(sessionStore(), claims.sub, sid)

  return ended
    ? NextResponse.json({ status: 'session-ended' })
    : NextResponse.json({ error: 'no_such_session' }, { status: 404 })
}
