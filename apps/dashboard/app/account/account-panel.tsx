'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/button'
import { Field, Notice } from '@/components/field'
import { call } from '@/lib/client'

type Session = {
  sid: string
  device: string
  country: string
  createdAt: number
  lastUsed: number
  current: boolean
}

export function ChangePassword({ minPassword }: { minPassword: number }) {
  const t = useTranslations('Account')
  const auth = useTranslations('Auth')
  const errors = useTranslations('Errors')
  const router = useRouter()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  return (
    <form
      className="mt-5 flex max-w-md flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError(undefined)
        setDone(false)

        const answer = await call('/api/auth/password/change', {
          currentPassword: current,
          password: next,
        })
        setBusy(false)
        if (answer.ok) {
          setDone(true)
          setCurrent('')
          setNext('')
          router.refresh()
        } else {
          setError(answer.error)
        }
      }}
    >
      <Field
        label={t('currentPassword')}
        type="password"
        autoComplete="current-password"
        value={current}
        required
        onChange={(event) => setCurrent(event.target.value)}
      />
      <Field
        label={t('newPassword')}
        hint={auth('passwordRules', { min: minPassword })}
        type="password"
        autoComplete="new-password"
        value={next}
        required
        onChange={(event) => setNext(event.target.value)}
      />

      {error === undefined ? null : (
        <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
      )}
      {done ? <Notice kind="good">{t('changed')}</Notice> : null}

      <Button type="submit" variant="solid" disabled={busy} className="self-start">
        {t('changePassword')}
      </Button>
    </form>
  )
}

export function Sessions() {
  const t = useTranslations('Account')
  const common = useTranslations('Common')
  const errors = useTranslations('Errors')
  const format = useFormatter()
  const router = useRouter()

  const [sessions, setSessions] = useState<Session[] | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    const answer = await call<{ sessions: Session[] }>('/api/auth/sessions')
    if (answer.ok) {
      setSessions(answer.body.sessions)
    } else {
      setError(answer.error)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="mt-10">
      <h2 className="font-semibold text-section tracking-tight">{t('sessions')}</h2>

      {error === undefined ? null : (
        <div className="mt-3">
          <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
        </div>
      )}

      {sessions === undefined ? (
        <p className="mt-4 text-muted-foreground">{common('loading')}</p>
      ) : (
        <ul className="mt-4 max-w-3xl border-border border-t">
          {sessions.map((session) => (
            <li
              key={session.sid}
              className="flex flex-wrap items-baseline gap-x-4 border-border border-b py-3"
            >
              <span className="min-w-0 flex-1 truncate">
                {session.device}
                {session.current ? (
                  <span className="ml-1.5 text-aside text-muted-foreground">
                    ({t('thisBrowser')})
                  </span>
                ) : null}
              </span>
              <span className="text-aside text-muted-foreground">
                {t('lastSeen')} {format.dateTime(new Date(session.lastUsed), 'short')}
              </span>
              {session.current ? null : (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await call('/api/auth/sessions', { sid: session.sid })
                    setBusy(false)
                    void load()
                  }}
                >
                  {t('endSession')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Button
        className="mt-4"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await call('/api/auth/logout-all', {})
          router.replace('/login')
          router.refresh()
        }}
      >
        {t('signOutEverywhere')}
      </Button>
    </section>
  )
}
