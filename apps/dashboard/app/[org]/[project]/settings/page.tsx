import { findProject, LEVELS, listKeys, may } from '@internal/auth'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { EnvironmentCard } from '@/components/environment-card'
import { type ApiKeyRow, KeysPanel } from '@/components/keys-panel'
import { Shell } from '@/components/shell'
import { loginDeps } from '@/lib/auth'
import { environmentsOf, organizationOr404, signedIn } from '@/lib/workspace'
import { DeleteProject, Rename } from './danger'
import { NewEnvironment } from './new-environment'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
}: {
  params: Promise<{ org: string; project: string }>
}) {
  const { org, project } = await params
  const signed = await signedIn()
  const organization = await organizationOr404(signed, org)

  const found = await findProject(loginDeps().run, org, project)
  if (found === undefined) {
    notFound()
  }

  const environments = await environmentsOf(org, project)
  const mayWrite = may(organization.role, 'projects:write')
  const mayKeys = may(organization.role, 'keys:write')
  const keys = mayKeys ? await listKeys(loginDeps().run, org, project) : []

  const t = await getTranslations('Environments')

  return (
    <Shell
      place={{ organization, project: { ...found, environments: environments.length } }}
      current="project-settings"
      justLooking={signed.justLooking}
    >
      <div className="max-w-3xl">
        <h1 className="font-semibold text-screen tracking-tight">{found.name}</h1>

        {mayWrite ? (
          <div className="mt-6">
            <Rename org={org} project={project} name={found.name} />
          </div>
        ) : null}

        <section className="mt-10">
          <h2 className="font-semibold text-section tracking-tight">{t('title')}</h2>
          <p className="mt-1 text-muted-foreground">{t('body')}</p>

          {mayWrite ? <NewEnvironment org={org} project={project} /> : null}

          <ul className="mt-6 border-border border-t">
            {environments.map((environment) => (
              <EnvironmentCard
                key={environment.id}
                org={org}
                project={project}
                environment={environment}
                mayWrite={mayWrite}
                onlyOne={environments.length === 1}
                levels={LEVELS}
              />
            ))}
          </ul>
        </section>

        {mayKeys ? (
          <KeysPanel
            org={org}
            project={project}
            environments={environments.map((one) => ({
              id: one.id,
              name: one.name,
              color: one.color,
            }))}
            keys={keys.map(
              (key): ApiKeyRow => ({
                id: key.id,
                environmentId: key.environmentId,
                environment: key.environment,
                kind: key.kind,
                hint: key.hint,
                scopes: [...key.scopes],
                lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
                revokedAt: key.revokedAt?.toISOString() ?? null,
                createdAt: key.createdAt.toISOString(),
              }),
            )}
            mayWrite={mayKeys}
          />
        ) : null}

        {may(organization.role, 'projects:delete') ? (
          <DeleteProject org={org} project={project} />
        ) : null}
      </div>
    </Shell>
  )
}
