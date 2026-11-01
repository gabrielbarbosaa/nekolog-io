import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  issueCreateArgs,
  issueListArgs,
  labelCreateArgs,
  labelListArgs,
  milestoneCreateArgs,
  milestoneListArgs,
  repoViewArgs,
} from './commands.ts'
import {
  issueBody,
  issueTitle,
  type Milestone,
  milestoneDescription,
  milestoneTitle,
  parseEtapas,
  parseGoals,
} from './etapas.ts'
import { LABELS, labelFor } from './labels.ts'
import { buildPlan, type ExistingState } from './plan.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const etapas = readFileSync(join(ROOT, 'docs', 'ETAPAS.md'), 'utf8')
const plano = readFileSync(join(ROOT, 'docs', 'PLANO.md'), 'utf8')

const SAMPLE = [
  '# Etapas',
  '',
  '## Antes do primeiro commit (tarefas manuais)',
  '',
  '- [ ] Comprar o domínio.',
  '- [ ] **9.9** `feat/orphan` — etapa fora de qualquer marco.',
  '',
  '## M0 — Fundação',
  '',
  '- [x] **0.1** `chore/repo-init` — repositório com as branches.',
  '- [ ] **0.2** `chore/github-tracking` — script com o `gh`.',
  '',
  '## M1 — Ingestão',
  '',
  '- [ ] **1.1** `feat/schema-v1` — formato do payload v1.',
  '- [ ] **1.2** `a11y/contrast` — contraste nas telas.',
].join('\n')

const nothing: ExistingState = {
  milestones: new Set<string>(),
  labels: new Set<string>(),
  issues: new Set<string>(),
}

function sampleMilestones(): Milestone[] {
  return parseEtapas(SAMPLE)
}

describe('parseEtapas', () => {
  it('reads every field of a step', () => {
    const [m0] = sampleMilestones()

    expect(m0?.steps[1]).toEqual({
      done: false,
      number: '0.2',
      prefix: 'chore',
      branch: 'chore/github-tracking',
      description: 'script com o `gh`.',
    })
  })

  it('knows which steps are already done', () => {
    const [m0] = sampleMilestones()

    expect(m0?.steps.map((step) => step.done)).toEqual([true, false])
  })

  it('groups the steps under the milestone they come after', () => {
    expect(sampleMilestones().map((m) => [m.key, m.steps.length])).toEqual([
      ['M0', 2],
      ['M1', 2],
    ])
  })

  it('ignores the manual tasks that have no step number', () => {
    expect(
      sampleMilestones()
        .flatMap((m) => m.steps)
        .map((step) => step.number),
    ).toEqual(['0.1', '0.2', '1.1', '1.2'])
  })

  it('drops a numbered step that sits before any milestone', () => {
    expect(
      sampleMilestones()
        .flatMap((m) => m.steps)
        .some((step) => step.branch === 'feat/orphan'),
    ).toBe(false)
  })

  it('reads a file with CRLF line endings the same way', () => {
    expect(parseEtapas(SAMPLE.replace(/\n/g, '\r\n'))).toEqual(sampleMilestones())
  })
})

describe('parseGoals', () => {
  it('reads the done-when column of the milestone table', () => {
    const goals = parseGoals(
      '| **M1 — Ingestão** | payload v1, core e node | um `log.info()` aparece no ClickHouse |',
    )

    expect(goals.get('M1')).toEqual({
      delivers: 'payload v1, core e node',
      doneWhen: 'um `log.info()` aparece no ClickHouse',
    })
  })

  it('says nothing rather than guessing when the table is missing', () => {
    expect(parseGoals('# Plano\n\nsem tabela').size).toBe(0)
  })
})

describe('milestoneDescription', () => {
  it('uses the done-when from the plan', () => {
    const milestone = { key: 'M1', name: 'Ingestão', steps: [] }
    const goals = parseGoals('| **M1 — Ingestão** | entrega | o log aparece |')

    expect(milestoneDescription(milestone, goals)).toBe('Pronto quando: o log aparece.')
  })

  it('still describes a milestone the plan does not list', () => {
    expect(milestoneDescription({ key: 'M9', name: 'Novo', steps: [] }, new Map())).toContain('M9')
  })
})

describe('issueTitle and issueBody', () => {
  it('titles the issue by number and branch, so it is searchable either way', () => {
    const [, m1] = sampleMilestones()
    const step = m1?.steps[0]

    expect(step && issueTitle(step)).toBe('1.1 feat/schema-v1')
  })

  it('opens the body with the description and names the branch and the milestone', () => {
    const [, m1] = sampleMilestones()
    const step = m1?.steps[0]
    const body = step && m1 ? issueBody(step, m1) : ''

    expect(body.startsWith('> formato do payload v1.')).toBe(true)
    expect(body).toContain('`feat/schema-v1`')
    expect(body).toContain('M1 — Ingestão')
  })

  it('does not promise the automatic closing that this repository cannot do', () => {
    const [, m1] = sampleMilestones()
    const step = m1?.steps[0]
    const body = step && m1 ? issueBody(step, m1) : ''

    expect(body).toContain('close-step-issue')
    expect(body).not.toMatch(/^\s*Closes #N/m)
  })

  it('ends every title with the branch name, which is how the workflow finds it', () => {
    for (const milestone of parseEtapas(etapas)) {
      for (const step of milestone.steps) {
        expect(issueTitle(step).endsWith(` ${step.branch}`)).toBe(true)
      }
    }
  })

  it('never ends one title with the branch of another step', () => {
    const steps = parseEtapas(etapas).flatMap((milestone) => milestone.steps)

    for (const step of steps) {
      const matching = steps.filter((other) => issueTitle(other).endsWith(` ${step.branch}`))
      expect(matching).toHaveLength(1)
    }
  })

  it('carries the definition of done as a checklist', () => {
    const [, m1] = sampleMilestones()
    const step = m1?.steps[0]
    const body = step && m1 ? issueBody(step, m1) : ''

    expect(body.split('\n').filter((line) => line.startsWith('- [ ] ')).length).toBe(7)
  })
})

describe('buildPlan', () => {
  const goals = parseGoals(plano)

  it('leaves out the steps that are already done', () => {
    const plan = buildPlan({ milestones: sampleMilestones(), goals, existing: nothing })

    expect(plan.totalSteps).toBe(4)
    expect(plan.consideredSteps).toBe(3)
    expect(plan.issues.map((issue) => issue.title)).toEqual([
      '0.2 chore/github-tracking',
      '1.1 feat/schema-v1',
      '1.2 a11y/contrast',
    ])
  })

  it('takes the done ones too when asked', () => {
    const plan = buildPlan({
      milestones: sampleMilestones(),
      goals,
      existing: nothing,
      includeDone: true,
    })

    expect(plan.issues.map((issue) => issue.title)).toContain('0.1 chore/repo-init')
  })

  it('plans a label only for the prefixes it is actually going to use', () => {
    const plan = buildPlan({ milestones: sampleMilestones(), goals, existing: nothing })

    expect(plan.labels.map((label) => label.name)).toEqual(['a11y', 'chore', 'feat'])
  })

  it('creates nothing twice', () => {
    const milestones = sampleMilestones()
    const first = buildPlan({ milestones, goals, existing: nothing })
    const second = buildPlan({
      milestones,
      goals,
      existing: {
        milestones: new Set(first.milestones.map((entry) => entry.title)),
        labels: new Set(first.labels.map((entry) => entry.name)),
        issues: new Set(first.issues.map((entry) => entry.title)),
      },
    })

    expect(second.milestones).toEqual([])
    expect(second.labels).toEqual([])
    expect(second.issues).toEqual([])
    expect(second.consideredSteps).toBe(first.consideredSteps)
  })

  it('files each issue under its own milestone and label', () => {
    const plan = buildPlan({ milestones: sampleMilestones(), goals, existing: nothing })

    expect(plan.issues.find((issue) => issue.title.startsWith('1.2'))).toMatchObject({
      label: 'a11y',
      milestone: 'M1 — Ingestão',
    })
  })

  it('plans a milestone even when every step in it is already done', () => {
    const plan = buildPlan({
      milestones: [{ key: 'M0', name: 'Fundação', steps: [] }],
      goals,
      existing: nothing,
    })

    expect(plan.milestones.map((entry) => entry.title)).toEqual(['M0 — Fundação'])
  })
})

describe('against the real docs/ETAPAS.md', () => {
  const milestones = parseEtapas(etapas)
  const steps = milestones.flatMap((milestone) => milestone.steps)

  it('finds the seven milestones', () => {
    expect(milestones.map((milestone) => milestone.key)).toEqual([
      'M0',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
    ])
  })

  it('finds every numbered step in the file', () => {
    const inFile = etapas.split(/\r?\n/).filter((line) => /^- \[.\] \*\*\d+\.\d+\*\*/.test(line))

    expect(steps).toHaveLength(inFile.length)
  })

  it('never reads the same step number twice', () => {
    expect(new Set(steps.map((step) => step.number)).size).toBe(steps.length)
  })

  it('gives every step a title no other step shares', () => {
    expect(new Set(steps.map(issueTitle)).size).toBe(steps.length)
  })

  it('uses only branch prefixes that have a label defined', () => {
    const unknown = [...new Set(steps.map((step) => step.prefix))].filter(
      (prefix) => !(prefix in LABELS),
    )

    expect(unknown).toEqual([])
  })

  it('numbers every step inside the milestone it belongs to', () => {
    for (const milestone of milestones) {
      const marker = milestone.key.slice(1)
      expect(milestone.steps.every((step) => step.number.startsWith(`${marker}.`))).toBe(true)
    }
  })

  it('knows when each milestone of the plan is done', () => {
    const goals = parseGoals(plano)

    for (const milestone of milestones) {
      expect(milestoneDescription(milestone, goals)).toMatch(/^Pronto quando: /)
    }
  })

  it('titles every milestone the way the plan writes it', () => {
    expect(milestones.map(milestoneTitle)).toContain('M1 — Ingestão')
  })
})

describe('labelFor', () => {
  it('knows every prefix the branch convention allows', () => {
    for (const prefix of [
      'a11y',
      'chore',
      'ci',
      'docs',
      'feat',
      'fix',
      'infra',
      'security',
      'test',
    ]) {
      expect(LABELS[prefix]).toBeDefined()
    }
  })

  it.each(Object.keys(LABELS))('gives %s a colour GitHub accepts', (prefix) => {
    expect(labelFor(prefix).colour).toMatch(/^[0-9a-f]{6}$/)
  })

  it('still answers for a prefix nobody defined', () => {
    expect(labelFor('whatever').description).not.toBe('')
  })
})

describe('the gh commands', () => {
  const issue = {
    title: '1.1 feat/schema-v1',
    body: 'primeira linha\n\n- [ ] item com `crase` e "aspas"',
    label: 'feat',
    milestone: 'M1 — Ingestão',
  }

  it('passes the issue body as an argument, never through stdin', () => {
    const args = issueCreateArgs(issue)

    expect(args).not.toContain('--body-file')
    expect(args).not.toContain('-')
    expect(args[args.indexOf('--body') + 1]).toBe(issue.body)
  })

  it('files the issue under its label and milestone', () => {
    const args = issueCreateArgs(issue)

    expect(args[args.indexOf('--label') + 1]).toBe('feat')
    expect(args[args.indexOf('--milestone') + 1]).toBe('M1 — Ingestão')
    expect(args[args.indexOf('--title') + 1]).toBe(issue.title)
  })

  it('counts closed issues as existing, so a closed one is not recreated', () => {
    expect(issueListArgs()).toContain('--state')
    expect(issueListArgs()[issueListArgs().indexOf('--state') + 1]).toBe('all')
  })

  it('asks for more issues and labels than the roadmap will ever have', () => {
    const issueLimit = Number(issueListArgs()[issueListArgs().indexOf('--limit') + 1])
    const labelLimit = Number(labelListArgs()[labelListArgs().indexOf('--limit') + 1])

    expect(issueLimit).toBeGreaterThan(parseEtapas(etapas).flatMap((m) => m.steps).length)
    expect(labelLimit).toBeGreaterThan(Object.keys(LABELS).length)
  })

  it('counts closed milestones as existing too', () => {
    expect(milestoneListArgs('owner/repo')).toContain('state=all')
    expect(milestoneListArgs('owner/repo')).toContain('repos/owner/repo/milestones')
  })

  it('sends the colour and the description when it creates a label', () => {
    const args = labelCreateArgs({ name: 'feat', colour: '0e8a16', description: 'Funcionalidade' })

    expect(args[args.indexOf('--color') + 1]).toBe('0e8a16')
    expect(args[args.indexOf('--description') + 1]).toBe('Funcionalidade')
  })

  it('describes the milestone it creates', () => {
    const args = milestoneCreateArgs('owner/repo', {
      title: 'M1 — Ingestão',
      description: 'Pronto quando: x.',
    })

    expect(args).toContain('title=M1 — Ingestão')
    expect(args).toContain('description=Pronto quando: x.')
  })

  it.each([
    ['repo view', repoViewArgs()],
    ['issue list', issueListArgs()],
    ['label list', labelListArgs()],
    ['milestone list', milestoneListArgs('owner/repo')],
    ['issue create', issueCreateArgs(issue)],
    ['label create', labelCreateArgs({ name: 'feat', colour: '0e8a16', description: 'x' })],
    ['milestone create', milestoneCreateArgs('owner/repo', { title: 'M1', description: 'x' })],
  ])('builds %s out of non-empty strings only', (_what, args) => {
    expect(args.every((arg) => typeof arg === 'string' && arg.length > 0)).toBe(true)
  })
})
