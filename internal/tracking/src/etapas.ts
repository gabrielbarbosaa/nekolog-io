export type Step = {
  done: boolean
  number: string
  prefix: string
  branch: string
  description: string
}

export type Milestone = {
  key: string
  name: string
  steps: Step[]
}

export type MilestoneGoal = {
  delivers: string
  doneWhen: string
}

const MILESTONE_HEADING = /^## (M[0-6]) — (.+)$/
const STEP_LINE = /^- \[( |x)\] \*\*(\d+\.\d+)\*\* `([a-z0-9]+)\/([a-z0-9-]+)` — (.+)$/
const PLANO_ROW = /^\| \*\*(M[0-6]) — [^|]+\*\* \| ([^|]+) \| ([^|]+) \|$/

export function parseEtapas(markdown: string): Milestone[] {
  const milestones: Milestone[] = []
  let current: Milestone | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const heading = MILESTONE_HEADING.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      current = { key: heading[1], name: heading[2].trim(), steps: [] }
      milestones.push(current)
      continue
    }

    const step = STEP_LINE.exec(line)
    if (step === null || current === null) {
      continue
    }
    current.steps.push({
      done: step[1] === 'x',
      number: step[2] ?? '',
      prefix: step[3] ?? '',
      branch: `${step[3]}/${step[4]}`,
      description: (step[5] ?? '').trim(),
    })
  }

  return milestones
}

export function parseGoals(markdown: string): Map<string, MilestoneGoal> {
  const goals = new Map<string, MilestoneGoal>()
  for (const line of markdown.split(/\r?\n/)) {
    const row = PLANO_ROW.exec(line.trim())
    if (row?.[1] !== undefined) {
      goals.set(row[1], {
        delivers: (row[2] ?? '').trim(),
        doneWhen: (row[3] ?? '').trim(),
      })
    }
  }
  return goals
}

export function milestoneTitle(milestone: Milestone): string {
  return `${milestone.key} — ${milestone.name}`
}

export function issueTitle(step: Step): string {
  return `${step.number} ${step.branch}`
}

export function milestoneDescription(
  milestone: Milestone,
  goals: Map<string, MilestoneGoal>,
): string {
  const goal = goals.get(milestone.key)
  return goal === undefined
    ? `Etapas do marco ${milestone.key}, em docs/ETAPAS.md.`
    : `Pronto quando: ${goal.doneWhen}.`
}

export function issueBody(step: Step, milestone: Milestone): string {
  return [
    `> ${step.description}`,
    '',
    `Etapa **${step.number}** do \`docs/ETAPAS.md\`, marco **${milestoneTitle(milestone)}**.`,
    '',
    `Branch \`${step.branch}\`, a partir da \`dev\`. O PR fecha esta issue com \`Closes #N\`.`,
    '',
    '### Pronto quando',
    '',
    '- [ ] CI verde: lint, tipos, testes e verificações de segurança',
    '- [ ] há testes novos cobrindo o que mudou',
    '- [ ] há um changeset, se mudou um pacote ou app',
    '- [ ] os textos de interface existem nos três idiomas',
    '- [ ] a documentação foi atualizada, se mudou algo público',
    '- [ ] o checklist de segurança foi seguido, se o PR tem o label `security`',
    '- [ ] a etapa foi marcada `[x]` no `docs/ETAPAS.md`',
  ].join('\n')
}
