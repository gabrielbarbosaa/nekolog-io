import { findProject } from '@internal/auth'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Shell } from '@/components/shell'
import { TraceTimeline } from '@/components/trace-timeline'
import { loginDeps } from '@/lib/auth'
import { traceOf } from '@/lib/logs'
import { offsetLabel, traceFrom, traceIdOf, windowAround } from '@/lib/trace'
import { environmentsOf, organizationOr404, signedIn } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; project: string; trace: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { org, project, trace } = await params
  const traceId = traceIdOf(trace)
  if (traceId === '') {
    notFound()
  }

  const signed = await signedIn()
  const organization = await organizationOr404(signed, org)

  const found = await findProject(loginDeps().run, org, project)
  if (found === undefined) {
    notFound()
  }

  const environments = await environmentsOf(org, project)
  const asked = await searchParams
  const at = typeof asked.at === 'string' ? new Date(asked.at) : new Date()
  const anchor = Number.isNaN(at.getTime()) ? new Date() : at
  const { from, to } = windowAround(anchor)

  const t = await getTranslations('Trace')

  let rows: Awaited<ReturnType<typeof traceOf>> = []
  let unavailable = false
  try {
    rows = await traceOf({
      traceId,
      projectId: project,
      environmentIds: environments.map((one) => one.id),
      from,
      to,
    })
  } catch (error) {
    console.error('[nekolog/dashboard] the trace lookup failed', error)
    unavailable = true
  }

  const timeline = traceFrom(traceId, rows)
  const named: Record<string, { name: string; color: string | undefined }> = {}
  for (const one of environments) {
    named[one.id] = { name: one.name, color: one.color }
  }

  return (
    <Shell
      place={{ organization, project: { ...found, environments: environments.length } }}
      current="logs"
      justLooking={signed.justLooking}
    >
      <header className="flex flex-col gap-1 border-border border-b px-4 py-3">
        <h1 className="font-mono text-section">{traceId}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-aside text-muted-foreground">
          <span>{t('steps', { count: timeline.steps.length })}</span>
          <span>{t('services', { count: timeline.services.length })}</span>
          <span className="font-mono tabular-nums">{offsetLabel(timeline.elapsedMs)}</span>
          {timeline.crossed ? <span>{t('crossed')}</span> : null}
        </p>
        <Link href={`/${org}/${project}/logs`} className="text-aside underline underline-offset-4">
          {t('backToLogs')}
        </Link>
      </header>

      {unavailable ? (
        <p role="alert" className="px-4 py-10 text-center text-muted-foreground">
          {t('unavailable')}
        </p>
      ) : (
        <TraceTimeline trace={timeline} environments={named} />
      )}
    </Shell>
  )
}
