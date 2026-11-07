'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { inputStyle, Notice } from '@/components/field'
import { call } from '@/lib/client'

export type MemberRow = {
  id: string
  userId: string
  name: string
  email: string
  role: string
  joinedAt: string
}

export type InviteRow = {
  id: string
  email: string
  role: string
  expiresAt: string
}

const ROLES = ['admin', 'member', 'viewer'] as const

export function MembersPanel({
  org,
  members,
  invites,
  you,
  role,
  mayWrite,
}: {
  org: string
  members: MemberRow[]
  invites: InviteRow[]
  you: string
  role: string
  mayWrite: boolean
}) {
  const t = useTranslations('Members')
  const errors = useTranslations('Errors')
  const format = useFormatter()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [invited, setInvited] = useState<(typeof ROLES)[number]>('member')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function act(path: string, body: Record<string, unknown>): Promise<void> {
    setBusy(true)
    setError(undefined)
    const answer = await call(`/api/orgs/${org}/${path}`, body)
    setBusy(false)
    if (answer.ok) {
      router.refresh()
    } else {
      setError(answer.error)
    }
  }

  return (
    <>
      {mayWrite ? (
        <form
          className="mt-6 flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setSent(false)
            setBusy(true)
            setError(undefined)

            const answer = await call(`/api/orgs/${org}/members/invite`, {
              email,
              role: invited,
            })
            setBusy(false)
            if (answer.ok) {
              setEmail('')
              setSent(true)
              router.refresh()
            } else {
              setError(answer.error)
            }
          }}
        >
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputStyle} max-w-xs`}
              type="email"
              value={email}
              required
              placeholder={t('inviteEmail')}
              aria-label={t('inviteEmail')}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              className={`${inputStyle} max-w-[10rem] pr-8`}
              value={invited}
              aria-label={t('role')}
              onChange={(event) => setInvited(event.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((one) => (
                <option key={one} value={one}>
                  {t(one)}
                </option>
              ))}
            </select>
            <Button type="submit" variant="solid" disabled={busy}>
              {t('invite')}
            </Button>
          </div>

          {error === undefined ? null : (
            <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
          )}
          {sent ? <Notice kind="good">{t('invited')}</Notice> : null}
        </form>
      ) : null}

      <ul className="mt-8 border-border border-t">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-border border-b py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="truncate font-medium">{member.name}</span>
              {member.userId === you ? (
                <span className="ml-1.5 text-aside text-muted-foreground">({t('you')})</span>
              ) : null}
              <span className="block truncate text-aside text-muted-foreground">
                {member.email}
              </span>
            </span>

            {mayWrite && !(member.role === 'owner' && role !== 'owner') ? (
              <select
                className={`${inputStyle} max-w-[9rem] pr-8`}
                value={member.role}
                disabled={busy}
                aria-label={t('role')}
                onChange={(event) =>
                  void act('members/role', { member: member.id, role: event.target.value })
                }
              >
                {(role === 'owner' ? (['owner', ...ROLES] as const) : ROLES).map((one) => (
                  <option key={one} value={one}>
                    {t(one)}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-muted-foreground">{t(member.role)}</span>
            )}

            {mayWrite && !(member.role === 'owner' && role !== 'owner') ? (
              <Button
                variant="quiet"
                disabled={busy}
                onClick={() => void act('members/remove', { member: member.id })}
              >
                {t('remove')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {invites.length === 0 ? null : (
        <section className="mt-10">
          <h2 className="font-semibold text-section tracking-tight">{t('pending')}</h2>
          <ul className="mt-4 border-border border-t">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-baseline gap-x-4 border-border border-b py-3"
              >
                <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                <span className="text-muted-foreground">{t(invite.role)}</span>
                <span className="text-aside text-muted-foreground">
                  {t('expires')} {format.dateTime(new Date(invite.expiresAt), 'short')}
                </span>
                {mayWrite ? (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void act('invites/revoke', { invite: invite.id })}
                  >
                    {t('revokeInvite')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
