import type { PlannedIssue, PlannedLabel, PlannedMilestone } from './plan.ts'

export function repoViewArgs(): string[] {
  return ['repo', 'view', '--json', 'nameWithOwner']
}

export function milestoneListArgs(repo: string): string[] {
  return ['api', '--paginate', '-X', 'GET', '-f', 'state=all', `repos/${repo}/milestones`]
}

export function labelListArgs(): string[] {
  return ['label', 'list', '--limit', '200', '--json', 'name']
}

export function issueListArgs(): string[] {
  return ['issue', 'list', '--state', 'all', '--limit', '1000', '--json', 'title']
}

export function milestoneCreateArgs(repo: string, milestone: PlannedMilestone): string[] {
  return [
    'api',
    `repos/${repo}/milestones`,
    '-f',
    `title=${milestone.title}`,
    '-f',
    `description=${milestone.description}`,
  ]
}

export function labelCreateArgs(label: PlannedLabel): string[] {
  return [
    'label',
    'create',
    label.name,
    '--color',
    label.colour,
    '--description',
    label.description,
  ]
}

export function issueCreateArgs(issue: PlannedIssue): string[] {
  return [
    'issue',
    'create',
    '--title',
    issue.title,
    '--body',
    issue.body,
    '--label',
    issue.label,
    '--milestone',
    issue.milestone,
  ]
}
