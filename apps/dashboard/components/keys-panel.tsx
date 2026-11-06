'use client'

import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useState } from 'react'
import { Button } from '@/components/button'
import { EnvDot } from '@/components/env-dot'
import { Notice } from '@/components/field'
import { call } from '@/lib/client'

export type ApiKeyRow = {
  id: string
  environmentId: string
  environment: string
  kind: 'public' | 'secret'
  hint: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export type EnvironmentRow = { id: string; name: string; color?: string | undefined }

export function KeysPanel({
  org,
  project,
  environments,
  keys,
  mayWrite,
}: {
  org: string
  project: string
  environments: EnvironmentRow[]
  keys: ApiKeyRow[]
  mayWrite: boolean
}) {
  const t = useTranslations('Keys')
  const errors = useTranslations('Errors')
  const format = useFormatter()
  const router = useRouter()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [minted, setMinted] = useState<string | undefined>(undefined)

  const live = keys.filter((key) => key.revokedAt === null)

  async function mint(environmentId: string, kind: 'public' | 'secret'): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call<{ value: string }>(
      `/api/orgs/${org}/projects/${project}/environments/${environmentId}/keys`,
      { kind },
    )
    setBusy(false)
    if (answer.ok) {
      setMinted(answer.body.value)
      router.refresh()
    } else {
      setError(answer.error)
    }
  }

  async function act(keyId: string, what: 'revoke' | 'rotate'): Promise<void> {
    setBusy(true)
    setError(undefined)

    const answer = await call<{ value?: string }>(
      `/api/orgs/${org}/projects/${project}/keys/${keyId}/${what}`,
      {},
    )
    setBusy(false)
    if (answer.ok) {
      if (answer.body.value !== undefined) {
        setMinted(answer.body.value)
      }
      router.refresh()
    } else {
      setError(answer.error)
    }
  }

  return (
    <section className="mt-10">
      <h2 className="font-semibold text-section tracking-tight">{t('title')}</h2>
      <p className="mt-1 text-muted-foreground">{t('body')}</p>

      {minted === undefined ? null : (
        <ShownOnce value={minted} onDone={() => setMinted(undefined)} />
      )}

      {error === undefined ? null : (
        <div className="mt-3">
          <Notice kind="bad">{errors.has(error) ? errors(error) : errors('unknown')}</Notice>
        </div>
      )}

      {mayWrite ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {environments.map((environment) => (
            <span key={environment.id} className="flex items-center gap-1">
              <Button
                disabled={busy}
                onClick={() => void mint(environment.id, 'secret')}
                title={t('mintSecret')}
              >
                <EnvDot colour={environment.color} />
                <span className="font-mono">{environment.name}</span>
                <span className="text-muted-foreground">{t('secret')}</span>
              </Button>
              <Button
                disabled={busy}
                onClick={() => void mint(environment.id, 'public')}
                title={t('mintPublic')}
              >
                <span className="text-muted-foreground">{t('public')}</span>
              </Button>
            </span>
          ))}
        </div>
      ) : null}

      {live.length === 0 ? (
        <p className="mt-6 border-border border-t pt-5 text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-6 border-border border-t">
          {live.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-border border-b py-3"
            >
              <span className="w-44 shrink-0 truncate font-mono">{key.hint}</span>
              <span className="flex items-baseline gap-1.5 text-muted-foreground">
                <EnvDot
                  colour={environments.find((one) => one.id === key.environmentId)?.color}
                  className="translate-y-[-1px]"
                />
                <span className="font-mono">{key.environment}</span>
              </span>
              <span className="text-aside text-muted-foreground">
                {key.kind === 'public' ? t('public') : t('secret')}
              </span>
              <span className="text-aside text-muted-foreground">
                {t('lastUsed')}:{' '}
                {key.lastUsedAt === null
                  ? t('never')
                  : format.dateTime(new Date(key.lastUsedAt), 'short')}
              </span>

              {mayWrite ? (
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="quiet"
                    disabled={busy}
                    title={t('rotateHint')}
                    onClick={() => void act(key.id, 'rotate')}
                  >
                    {t('rotate')}
                  </Button>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void act(key.id, 'revoke')}
                  >
                    {t('revoke')}
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-aside text-muted-foreground">{t('waiting')}</p>
    </section>
  )
}

function ShownOnce({ value, onDone }: { value: string; onDone: () => void }) {
  const t = useTranslations('Keys')
  const [copied, setCopied] = useState(false)

  return (
    <div className="mt-5 rounded-md border border-border bg-card p-4">
      <h3 className="font-medium">{t('onceTitle')}</h3>
      <p className="mt-1 text-aside text-muted-foreground">{t('onceBody')}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-2.5 py-1.5 font-mono">
          {value}
        </code>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
        <Button variant="solid" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  )
}
