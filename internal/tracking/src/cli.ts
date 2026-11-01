import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parseEtapas, parseGoals } from './etapas.ts'
import { buildPlan, type SyncPlan } from './plan.ts'

const run = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ETAPAS = join(ROOT, 'docs', 'ETAPAS.md')
const PLANO = join(ROOT, 'docs', 'PLANO.md')

export const CREATE_DELAY_MS = 1_200

async function gh(args: string[], input?: string): Promise<string> {
  const { stdout } = await run('gh', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
    ...(input === undefined ? {} : { input }),
  })
  return stdout
}

async function currentRepo(): Promise<string> {
  const raw = await gh(['repo', 'view', '--json', 'nameWithOwner'])
  return (JSON.parse(raw) as { nameWithOwner: string }).nameWithOwner
}

async function titlesOfMilestones(repo: string): Promise<Set<string>> {
  const raw = await gh([
    'api',
    '--paginate',
    '-X',
    'GET',
    '-f',
    'state=all',
    `repos/${repo}/milestones`,
  ])
  return new Set((JSON.parse(raw) as Array<{ title: string }>).map((entry) => entry.title))
}

async function namesOfLabels(): Promise<Set<string>> {
  const raw = await gh(['label', 'list', '--limit', '200', '--json', 'name'])
  return new Set((JSON.parse(raw) as Array<{ name: string }>).map((entry) => entry.name))
}

async function titlesOfIssues(): Promise<Set<string>> {
  const raw = await gh(['issue', 'list', '--state', 'all', '--limit', '1000', '--json', 'title'])
  return new Set((JSON.parse(raw) as Array<{ title: string }>).map((entry) => entry.title))
}

function write(line: string): void {
  process.stdout.write(`${line}\n`)
}

function describePlan(plan: SyncPlan, repo: string, apply: boolean, includeDone: boolean): void {
  write(`repositório: ${repo}`)
  write(`modo: ${apply ? 'APLICANDO' : 'simulação — use --apply para valer'}`)
  write(`etapas no arquivo: ${plan.totalSteps}`)
  write(
    `etapas consideradas: ${plan.consideredSteps}${includeDone ? ' (todas)' : ' (só as não concluídas)'}`,
  )
  write(
    `a criar: ${plan.milestones.length} milestones, ${plan.labels.length} labels, ${plan.issues.length} issues`,
  )
  write('')
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply')
  const includeDone = process.argv.includes('--include-done')

  const milestones = parseEtapas(readFileSync(ETAPAS, 'utf8'))
  if (milestones.length === 0) {
    throw new Error(`Nenhum marco encontrado em ${ETAPAS}. O formato do arquivo mudou?`)
  }

  const repo = await currentRepo()
  const plan = buildPlan({
    milestones,
    goals: parseGoals(readFileSync(PLANO, 'utf8')),
    existing: {
      milestones: await titlesOfMilestones(repo),
      labels: await namesOfLabels(),
      issues: await titlesOfIssues(),
    },
    includeDone,
  })

  describePlan(plan, repo, apply, includeDone)

  for (const milestone of plan.milestones) {
    write(`${apply ? 'criando' : 'criaria'} milestone ${milestone.title}`)
    if (apply) {
      await gh([
        'api',
        `repos/${repo}/milestones`,
        '-f',
        `title=${milestone.title}`,
        '-f',
        `description=${milestone.description}`,
      ])
    }
  }

  for (const label of plan.labels) {
    write(`${apply ? 'criando' : 'criaria'} label ${label.name}`)
    if (apply) {
      await gh([
        'label',
        'create',
        label.name,
        '--color',
        label.colour,
        '--description',
        label.description,
      ])
    }
  }

  const failed: Array<{ title: string; why: string }> = []
  let created = 0

  for (const issue of plan.issues) {
    write(`${apply ? 'criando' : 'criaria'} issue ${issue.title}`)
    if (!apply) {
      continue
    }
    try {
      await gh(
        [
          'issue',
          'create',
          '--title',
          issue.title,
          '--body-file',
          '-',
          '--label',
          issue.label,
          '--milestone',
          issue.milestone,
        ],
        issue.body,
      )
      created += 1
    } catch (error) {
      failed.push({
        title: issue.title,
        why: (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? '',
      })
    }
    await sleep(CREATE_DELAY_MS)
  }

  if (apply) {
    write(`\n${created} issues criadas`)
  }
  if (failed.length > 0) {
    write(`\n${failed.length} falharam:`)
    for (const entry of failed) {
      write(`  ${entry.title}: ${entry.why}`)
    }
    process.exitCode = 1
  }
}

await main()
