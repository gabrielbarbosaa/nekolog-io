import {
  issueBody,
  issueTitle,
  type Milestone,
  type MilestoneGoal,
  milestoneDescription,
  milestoneTitle,
} from './etapas.ts'
import { type LabelDefinition, labelFor } from './labels.ts'

export type ExistingState = {
  milestones: ReadonlySet<string>
  labels: ReadonlySet<string>
  issues: ReadonlySet<string>
}

export type PlannedMilestone = {
  title: string
  description: string
}

export type PlannedLabel = LabelDefinition & {
  name: string
}

export type PlannedIssue = {
  title: string
  body: string
  label: string
  milestone: string
}

export type SyncPlan = {
  milestones: PlannedMilestone[]
  labels: PlannedLabel[]
  issues: PlannedIssue[]
  totalSteps: number
  consideredSteps: number
}

export type BuildPlanOptions = {
  milestones: Milestone[]
  goals: Map<string, MilestoneGoal>
  existing: ExistingState
  includeDone?: boolean
}

export function buildPlan(options: BuildPlanOptions): SyncPlan {
  const includeDone = options.includeDone === true
  const { existing } = options

  const considered = options.milestones.flatMap((milestone) =>
    milestone.steps
      .filter((step) => includeDone || !step.done)
      .map((step) => ({ step, milestone })),
  )

  const milestones = options.milestones
    .map((milestone) => ({
      title: milestoneTitle(milestone),
      description: milestoneDescription(milestone, options.goals),
    }))
    .filter((planned) => !existing.milestones.has(planned.title))

  const labels = [...new Set(considered.map(({ step }) => step.prefix))]
    .sort()
    .filter((name) => !existing.labels.has(name))
    .map((name) => ({ name, ...labelFor(name) }))

  const issues = considered
    .map(({ step, milestone }) => ({
      title: issueTitle(step),
      body: issueBody(step, milestone),
      label: step.prefix,
      milestone: milestoneTitle(milestone),
    }))
    .filter((planned) => !existing.issues.has(planned.title))

  return {
    milestones,
    labels,
    issues,
    totalSteps: options.milestones.reduce((total, milestone) => total + milestone.steps.length, 0),
    consideredSteps: considered.length,
  }
}
