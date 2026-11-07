import { findProject } from '@internal/auth'
import { notFound } from 'next/navigation'
import { Shell } from '@/components/shell'
import { loginDeps } from '@/lib/auth'
import { queryFrom } from '@/lib/explorer'
import { environmentsOf, organizationOr404, signedIn } from '@/lib/workspace'
import { Explorer } from './explorer'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { org, project } = await params
  const signed = await signedIn()
  const organization = await organizationOr404(signed, org)

  const found = await findProject(loginDeps().run, org, project)
  if (found === undefined) {
    notFound()
  }

  const environments = await environmentsOf(org, project)
  const asked = new URLSearchParams()
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') {
      asked.set(name, value)
    }
  }

  return (
    <Shell
      place={{ organization, project: { ...found, environments: environments.length } }}
      current="logs"
      bare
      justLooking={signed.justLooking}
    >
      <Explorer
        org={org}
        project={project}
        environments={environments.map((one) => ({
          id: one.id,
          name: one.name,
          color: one.color,
        }))}
        initial={queryFrom(
          asked,
          environments.map((one) => one.id),
        )}
      />
    </Shell>
  )
}
