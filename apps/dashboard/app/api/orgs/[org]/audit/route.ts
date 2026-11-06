import { AUDIT_PAGE, listAudit } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { guard } from '@/lib/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'audit:read', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  return NextResponse.json({ entries: await listAudit(loginDeps().run, org, AUDIT_PAGE) })
}
