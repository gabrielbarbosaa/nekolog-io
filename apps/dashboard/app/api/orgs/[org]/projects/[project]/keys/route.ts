import { findProject, listKeys } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string; project: string }> },
): Promise<Response> {
  const { org, project } = await params
  const gate = await guard(request, org, 'keys:write', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  if ((await findProject(run, org, project)) === undefined) {
    return refusal('no_such_project', 404)
  }

  const keys = (await listKeys(run, org, project)).map((key) => ({
    ...key,
    lastUsedAt: key.lastUsedAt ?? null,
    revokedAt: key.revokedAt ?? null,
  }))

  return NextResponse.json({ keys })
}
