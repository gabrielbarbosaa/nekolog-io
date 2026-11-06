import { listInvites, listMembers } from '@internal/auth'
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
  const gate = await guard(request, org, 'logs:read', { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const run = loginDeps().run
  const members = await listMembers(run, org)
  const invites =
    gate.allowed.role === 'owner' || gate.allowed.role === 'admin'
      ? await listInvites(run, org)
      : []

  return NextResponse.json({ members, invites, you: gate.allowed.role })
}
