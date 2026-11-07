import { may } from '@internal/auth'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Shell } from '@/components/shell'
import { organizationOr404, projectsOf, signedIn } from '@/lib/workspace'
import { NewProject } from './new-project'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params
  const signed = await signedIn()
  const organization = await organizationOr404(signed, org)
  const projects = await projectsOf(org)
  const t = await getTranslations('Projects')

  return (
    <Shell place={{ organization }} current="projects">
      <div className="max-w-3xl">
        <h1 className="font-semibold text-screen tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-muted-foreground">{t('body')}</p>

        {may(organization.role, 'projects:write') ? (
          <div className="mt-6">
            <NewProject org={org} />
          </div>
        ) : null}

        {projects.length === 0 ? (
          <p className="mt-8 border-border border-t pt-6 text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="mt-8 border-border border-t">
            {projects.map((project) => (
              <li key={project.id} className="border-border border-b">
                <Link
                  href={`/${org}/${project.id}/settings`}
                  className="flex items-baseline justify-between gap-4 py-3 hover:bg-accent"
                >
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="shrink-0 text-aside text-muted-foreground">
                    {t('environments', { count: project.environments })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  )
}
