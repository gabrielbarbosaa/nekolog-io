import {
  findAccountById,
  INVITE_DAYS,
  inviteEmail,
  listOrganizations,
  startAnOrganization,
} from '@internal/auth'
import { after, NextResponse } from 'next/server'
import { authSettings, loginDeps, mail } from '@/lib/auth'
import { refusal } from '@/lib/guard'
import { operatorGuard } from '@/lib/operator'
import { jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  const gate = await operatorGuard(request, { writes: false })
  if ('refused' in gate) {
    return gate.refused
  }

  const organizations = await listOrganizations(loginDeps().run)

  return NextResponse.json({
    organizations: organizations.map((one) => ({
      id: one.id,
      name: one.name,
      members: one.members,
      projects: one.projects,
      dailyEventQuota: one.dailyEventQuota,
      maxRetentionDays: one.maxRetentionDays,
      suspendedAt: one.suspendedAt?.toISOString() ?? null,
      createdAt: one.createdAt.toISOString(),
    })),
  })
}

export async function POST(request: Request): Promise<Response> {
  const gate = await operatorGuard(request)
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  const run = loginDeps().run
  const name = stringField(body, 'name')
  const started = await startAnOrganization(run, {
    name,
    email: stringField(body, 'email'),
    invitedBy: gate.allowed.userId,
  })

  if (started.outcome === 'bad-name') {
    return refusal('bad_name', 422)
  }
  if (started.outcome !== 'started') {
    return refusal('bad_address', 422)
  }

  const operator = await findAccountById(run, gate.allowed.userId)
  const message = inviteEmail({
    organization: name.trim(),
    inviter: operator?.name ?? '',
    locale: operator?.locale,
    appUrl: authSettings().appUrl,
    token: started.token,
    days: INVITE_DAYS,
  })

  after(async () => {
    try {
      await mail().send({
        to: started.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
    } catch (error) {
      console.error('the invitation could not be sent', error)
    }
  })

  return NextResponse.json(
    { organization: started.organizationId, invite: started.inviteId, email: started.email },
    { status: 201 },
  )
}
