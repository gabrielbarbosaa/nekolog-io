'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

type Organization = {
  id: string
  name: string
  members: number
  projects: number
  dailyEventQuota: number
  maxRetentionDays: number
  suspendedAt: string | null
  createdAt: string
}

type Account = {
  id: string
  name: string
  email: string
  isOperator: boolean
  suspendedAt: string | null
  confirmedAt: string | null
  createdAt: string
}

export function OperatorArea() {
  const t = useTranslations('Operator')
  const errors = useTranslations('Errors')
  const format = useFormatter()

  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [invited, setInvited] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    const [listed, counted] = await Promise.all([
      call<{ organizations: Organization[] }>('/api/operator/organizations'),
      call<{ usage: Record<string, number> }>('/api/operator/usage'),
    ])

    if (listed.ok) {
      setOrganizations(listed.body.organizations)
      setRefused(undefined)
    } else {
      setRefused(listed.error)
    }
    setUsage(counted.ok ? counted.body.usage : {})
  }, [])

  const loadAccounts = useCallback(async (query: string) => {
    const found = await call<{ accounts: Account[] }>(
      `/api/operator/accounts?q=${encodeURIComponent(query)}`,
    )
    setAccounts(found.ok ? found.body.accounts : [])
  }, [])

  useEffect(() => {
    void load()
    void loadAccounts('')
  }, [load, loadAccounts])

  async function startOne(event: FormEvent) {
    event.preventDefault()
    const answer = await call('/api/operator/organizations', { name, email })

    if (answer.ok) {
      setInvited(email)
      setName('')
      setEmail('')
      await load()
      return
    }
    setRefused(answer.error)
  }

  async function act(path: string, body: Record<string, unknown>, after: () => Promise<void>) {
    const answer = await call(path, body)
    if (answer.ok) {
      setRefused(undefined)
      await after()
      return
    }
    setRefused(answer.error)
  }

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      {refused === undefined ? null : (
        <Notice kind="bad">{errors.has(refused) ? errors(refused) : errors('unknown')}</Notice>
      )}

      <section>
        <h2 className="font-semibold text-section tracking-tight">{t('startTitle')}</h2>
        <p className="mt-1 text-muted-foreground">{t('startBody')}</p>

        <form onSubmit={startOne} className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Field
              label={t('organizationName')}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
          <div className="min-w-56 flex-1">
            <Field
              label={t('founderEmail')}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="solid">
            {t('start')}
          </Button>
        </form>

        {invited === undefined ? null : (
          <div className="mt-3">
            <Notice kind="good">{t('invited', { email: invited })}</Notice>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-semibold text-section tracking-tight">{t('organizationsTitle')}</h2>
        <p className="mt-1 text-muted-foreground">{t('organizationsBody')}</p>

        <table className="mt-4 w-full border-collapse text-data">
          <thead>
            <tr className="border-border border-b text-aside text-muted-foreground">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">
                {t('organization')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('usedToday')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('quota')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('retention')}
              </th>
              <th scope="col" className="px-2 py-1.5 text-right font-medium">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <OrganizationRow
                key={organization.id}
                organization={organization}
                used={usage[organization.id] ?? 0}
                onChange={load}
                act={act}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold text-section tracking-tight">{t('accountsTitle')}</h2>
        <p className="mt-1 text-muted-foreground">{t('accountsBody')}</p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void loadAccounts(search)
          }}
          className="mt-4 flex items-end gap-3"
        >
          <div className="min-w-56 flex-1">
            <Field
              label={t('findAccount')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Button type="submit">{t('find')}</Button>
        </form>

        <ul className="mt-4 border-border border-t">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center gap-3 border-border border-b px-2 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{account.name}</span>
                <span className="block truncate text-aside text-muted-foreground">
                  {account.email}
                </span>
              </span>

              {account.confirmedAt === null ? (
                <span className="text-aside text-muted-foreground">{t('unconfirmed')}</span>
              ) : null}
              {account.isOperator ? (
                <span className="text-aside text-muted-foreground">{t('operator')}</span>
              ) : null}
              {account.suspendedAt === null ? null : (
                <span className="text-aside text-destructive">{t('suspended')}</span>
              )}

              <span className="text-aside text-muted-foreground">
                {format.dateTime(new Date(account.createdAt), { dateStyle: 'medium' })}
              </span>

              <Button
                onClick={() =>
                  void act(
                    `/api/operator/accounts/${account.id}`,
                    { suspended: account.suspendedAt === null },
                    () => loadAccounts(search),
                  )
                }
              >
                {account.suspendedAt === null ? t('suspend') : t('restore')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function OrganizationRow({
  organization,
  used,
  onChange,
  act,
}: {
  organization: Organization
  used: number
  onChange: () => Promise<void>
  act: (path: string, body: Record<string, unknown>, after: () => Promise<void>) => Promise<void>
}) {
  const t = useTranslations('Operator')
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const [quota, setQuota] = useState(String(organization.dailyEventQuota))
  const [retention, setRetention] = useState(String(organization.maxRetentionDays))

  const where = `/api/operator/organizations/${organization.id}`

  return (
    <>
      <tr className="border-border border-b">
        <th scope="row" className="px-2 py-2 text-left font-normal">
          <span className="block truncate">{organization.name}</span>
          <span className="block truncate text-aside text-muted-foreground">
            {t('counts', { members: organization.members, projects: organization.projects })}
            {organization.suspendedAt === null ? '' : ` · ${t('suspended')}`}
          </span>
        </th>
        <td className="px-2 py-2 text-right font-mono tabular-nums">{format.number(used)}</td>
        <td className="px-2 py-2 text-right font-mono tabular-nums">
          {format.number(organization.dailyEventQuota)}
        </td>
        <td className="px-2 py-2 text-right font-mono tabular-nums">
          {organization.maxRetentionDays}
        </td>
        <td className="px-2 py-2 text-right">
          <span className="flex justify-end gap-2">
            <Button className="h-7 px-2" onClick={() => setOpen(!open)} aria-expanded={open}>
              {t('adjust')}
            </Button>
            <Button
              className="h-7 px-2"
              onClick={() =>
                void act(where, { suspended: organization.suspendedAt === null }, onChange)
              }
            >
              {organization.suspendedAt === null ? t('suspend') : t('restore')}
            </Button>
          </span>
        </td>
      </tr>

      {open ? (
        <tr className="border-border border-b bg-muted/40">
          <td colSpan={5} className="px-2 py-3">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void act(
                  where,
                  { dailyEventQuota: Number(quota), maxRetentionDays: Number(retention) },
                  async () => {
                    setOpen(false)
                    await onChange()
                  },
                )
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <Field
                label={t('quota')}
                type="number"
                min={1}
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
              />
              <Field
                label={t('retention')}
                type="number"
                min={1}
                value={retention}
                onChange={(event) => setRetention(event.target.value)}
                hint={t('retentionHint')}
              />
              <Button type="submit" variant="solid">
                {t('save')}
              </Button>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  )
}
