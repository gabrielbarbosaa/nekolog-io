import { deleteOrganization } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal, theyTypedTheirPassword } from '@/lib/guard'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'organization:delete')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  if (!(await theyTypedTheirPassword(gate.allowed.claims.sub, stringField(body, 'password')))) {
    return refusal('invalid_credentials', 401)
  }

  if (!(await deleteOrganization(loginDeps().run, org))) {
    return refusal('no_such_organization', 404)
  }

  return NextResponse.json({ status: 'deleted' })
}
