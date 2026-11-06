import { listSessions, originAllowed, revokeOwnSession } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings } from '@/lib/auth'
import { notTheDemo } from '@/lib/demo'
import { jsonBody, stringField } from '@/lib/request'
import { sessionStore } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const gate = await notTheDemo(request)
  if ('refused' in gate) {
    return gate.refused
  }
  const { claims } = gate

  const open = await listSessions(sessionStore(), claims.sub)

  return NextResponse.json({
    sessions: open.map((session) => ({ ...session, current: session.sid === claims.sid })),
  })
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const gate = await notTheDemo(request)
  if ('refused' in gate) {
    return gate.refused
  }
  const { claims } = gate

  const sid = stringField(await jsonBody(request), 'sid')
  const ended = await revokeOwnSession(sessionStore(), claims.sub, sid)

  return ended
    ? NextResponse.json({ status: 'session-ended' })
    : NextResponse.json({ error: 'no_such_session' }, { status: 404 })
}
