import { listAccounts } from '@internal/auth'
import { NextResponse } from 'next/server'
import { loginDeps } from '@/lib/auth'
import { operatorGuard } from '@/lib/operator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const ACCOUNT_PARAMETERS: readonly string[] = ['q']

export async function GET(request: Request): Promise<Response> {
  const gate = await operatorGuard(request, { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const asked = new URL(request.url).searchParams
  for (const name of asked.keys()) {
    if (!ACCOUNT_PARAMETERS.includes(name)) {
      return NextResponse.json({ error: 'unknown_parameter' }, { status: 400 })
    }
  }

  const accounts = await listAccounts(loginDeps().run, asked.get('q') ?? '')

  return NextResponse.json({
    accounts: accounts.map((one) => ({
      id: one.id,
      name: one.name,
      email: one.email,
      isOperator: one.isOperator,
      suspendedAt: one.suspendedAt?.toISOString() ?? null,
      confirmedAt: one.emailVerifiedAt?.toISOString() ?? null,
      createdAt: one.createdAt.toISOString(),
    })),
  })
}
