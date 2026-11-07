import { listInvites, listMembers, may } from '@internal/auth'
import { getTranslations } from 'next-intl/server'
import { Shell } from '@/components/shell'
import { loginDeps } from '@/lib/auth'
import { organizationOr404, signedIn } from '@/lib/workspace'
import { type InviteRow, type MemberRow, MembersPanel } from './members-panel'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const signed = await signedIn()
  const organization = await organizationOr404(signed, org)

  const run = loginDeps().run
  const mayWrite = may(organization.role, 'members:write')
  const members = await listMembers(run, org)
  const invites = mayWrite ? await listInvites(run, org) : []

  const t = await getTranslations('Members')

  return (
    <Shell place={{ organization }} current="members" justLooking={signed.justLooking}>
      <div className="max-w-3xl">
        <h1 className="font-semibold text-screen tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('body')}</p>

        <MembersPanel
          org={org}
          you={signed.userId}
          role={organization.role}
          mayWrite={mayWrite}
          members={members.map(
            (member): MemberRow => ({
              id: member.id,
              userId: member.userId,
              name: member.name,
              email: member.email,
              role: member.role,
              joinedAt: member.joinedAt.toISOString(),
            }),
          )}
          invites={invites.map(
            (invite): InviteRow => ({
              id: invite.id,
              email: invite.email,
              role: invite.role,
              expiresAt: invite.expiresAt.toISOString(),
            }),
          )}
        />
      </div>
    </Shell>
  )
}
