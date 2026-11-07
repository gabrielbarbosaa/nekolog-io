'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

export function Rename({ org, project, name }: { org: string; project: string; name: string }) {
  const t = useTranslations('Project')
  const projects = useTranslations('Projects')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        setDone(false)

        const answer = await call(`/api/orgs/${org}/projects/${project}`, { name: value })
        setBusy(false)
        if (answer.ok) {
          setDone(true)
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <div className="flex max-w-md items-end gap-2">
        <div className="flex-1">
          <Field
            label={projects('name')}
            value={value}
            required
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || value === name}>
          {t('rename')}
        </Button>
      </div>

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}
      {done ? <Notice kind="good">{t('renamed')}</Notice> : null}
    </form>
  )
}

export function DeleteProject({ org, project }: { org: string; project: string }) {
  const t = useTranslations('Project')
  const common = useTranslations('Common')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="mt-10 max-w-md border-destructive/40 border-t pt-5"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)

        const answer = await call(`/api/orgs/${org}/projects/${project}/delete`, { password })
        setBusy(false)
        if (answer.ok) {
          router.replace(`/${org}/projects`)
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <h2 className="font-semibold text-section tracking-tight">{t('deleteTitle')}</h2>
      <p className="mt-1 text-muted-foreground">{t('deleteBody')}</p>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Field
            label={common('confirmPassword')}
            type="password"
            autoComplete="current-password"
            value={password}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || password === ''}>
          {t('delete')}
        </Button>
      </div>

      {error === undefined ? null : (
        <div className="mt-2">
          <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
        </div>
      )}
    </form>
  )
}
