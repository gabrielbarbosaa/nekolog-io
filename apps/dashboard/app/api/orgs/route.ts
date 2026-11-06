import { createOrganization, organizationsOf, originAllowed, recordAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { authSettings, loginDeps } from '@/lib/auth'
import { countryOf, jsonBody, stringField } from '@/lib/request'
import { liveSession } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  return NextResponse.json({ organizations: await organizationsOf(loginDeps().run, claims.sub) })
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), authSettings().appUrl)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const claims = await liveSession(request)
  if (claims === undefined) {
    return NextResponse.json({ error: 'signed_out' }, { status: 401 })
  }

  const run = loginDeps().run
  const organizationId = await createOrganization(run, {
    name: stringField(await jsonBody(request), 'name'),
    ownerUserId: claims.sub,
  })

  if (organizationId === undefined) {
    return NextResponse.json({ error: 'bad_name' }, { status: 422 })
  }

  await recordAudit(run, {
    organizationId,
    actorUserId: claims.sub,
    action: 'organization.created',
    targetType: 'organization',
    targetId: organizationId,
    country: countryOf(request.headers),
  })

  return NextResponse.json({ organization: organizationId }, { status: 201 })
}
