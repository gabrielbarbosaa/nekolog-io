import {
  findAccountById,
  INVITE_DAYS,
  inviteEmail,
  inviteMember,
  isRole,
  mayGrant,
  recordAudit,
} from '@internal/auth'
import { after, NextResponse } from 'next/server'
import { authSettings, loginDeps, mail } from '@/lib/auth'
import { guard, refusal } from '@/lib/guard'
import { countryOf, jsonBody, stringField } from '@/lib/request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORGANIZATION_NAME = `select name from organizations where id = $1`

export async function POST(
  request: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  const { org } = await params
  const gate = await guard(request, org, 'members:write')
  if ('refused' in gate) {
    return gate.refused
  }

  const body = await jsonBody(request)
  const role = stringField(body, 'role')
  if (!isRole(role) || !mayGrant(gate.allowed.role, role)) {
    return refusal('not_allowed', 403)
  }

  const run = loginDeps().run
  const invited = await inviteMember(run, {
    organizationId: org,
    email: stringField(body, 'email'),
    role,
    invitedBy: gate.allowed.claims.sub,
  })

  if (invited.outcome === 'bad-role') {
    return refusal('not_allowed', 403)
  }
  if (invited.outcome === 'already-a-member') {
    return refusal('already_a_member', 409)
  }

  const [organization] = await run(ORGANIZATION_NAME, [org])
  const inviter = await findAccountById(run, gate.allowed.claims.sub)
  const message = inviteEmail({
    organization: String(organization?.name ?? ''),
    inviter: inviter?.name ?? '',
    locale: inviter?.locale,
    appUrl: authSettings().appUrl,
    token: invited.token,
    days: INVITE_DAYS,
  })

  after(async () => {
    try {
      await mail().send({
        to: invited.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      })
    } catch (error) {
      console.error('the invitation could not be sent', error)
    }
  })

  await recordAudit(run, {
    organizationId: org,
    actorUserId: gate.allowed.claims.sub,
    action: 'member.invited',
    targetType: 'invite',
    targetId: invited.inviteId,
    metadata: { role },
    country: countryOf(request.headers),
  })

  return NextResponse.json({ status: 'invited', invite: invited.inviteId })
}
