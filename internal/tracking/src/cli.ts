import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  issueCreateArgs,
  issueListArgs,
  labelCreateArgs,
  labelListArgs,
  milestoneCreateArgs,
  milestoneListArgs,
  repoViewArgs,
} from './commands.ts'
import { parseEtapas, parseGoals } from './etapas.ts'
import { buildPlan, type SyncPlan } from './plan.ts'

const run = promisify(execFile)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ETAPAS = join(ROOT, 'docs', 'ETAPAS.md')
const PLANO = join(ROOT, 'docs', 'PLANO.md')

export const CREATE_DELAY_MS = 1_200
export const CALL_TIMEOUT_MS = 30_000

async function gh(args: string[]): Promise<string> {
  const { stdout } = await run('gh', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 32,
    timeout: CALL_TIMEOUT_MS,
  })
  return stdout
}

function titlesFrom(raw: string, field: 'title' | 'name'): Set<string> {
  const entries = JSON.parse(raw) as Array<Record<string, string>>
  return new Set(entries.map((entry) => entry[field] ?? ''))
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

  const repo = (JSON.parse(await gh(repoViewArgs())) as { nameWithOwner: string }).nameWithOwner
  const plan = buildPlan({
    milestones,
    goals: parseGoals(readFileSync(PLANO, 'utf8')),
    existing: {
      milestones: titlesFrom(await gh(milestoneListArgs(repo)), 'title'),
      labels: titlesFrom(await gh(labelListArgs()), 'name'),
      issues: titlesFrom(await gh(issueListArgs()), 'title'),
    },
    includeDone,
  })

  describePlan(plan, repo, apply, includeDone)

  for (const milestone of plan.milestones) {
    write(`${apply ? 'criando' : 'criaria'} milestone ${milestone.title}`)
    if (apply) {
      await gh(milestoneCreateArgs(repo, milestone))
    }
  }

  for (const label of plan.labels) {
    write(`${apply ? 'criando' : 'criaria'} label ${label.name}`)
    if (apply) {
      await gh(labelCreateArgs(label))
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
      await gh(issueCreateArgs(issue))
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
