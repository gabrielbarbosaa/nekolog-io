import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')
const REPO_MAIN = readFileSync(join(ROOT, 'infra', 'repo', 'main.tf'), 'utf8')

const JOB = /\n {2}([a-z][a-z0-9_-]*):\n((?: {4}\S[^\n]*\n|\n)*)/g
const ADVANCED_SECURITY = [
  'github/codeql-action',
  'actions/dependency-review-action',
  'ossf/scorecard-action',
  'security-events',
]

function workflowFiles(): string[] {
  return readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'))
}

function checksEveryJobReports(): string[] {
  const names: string[] = []

  for (const file of workflowFiles()) {
    const text = readFileSync(join(WORKFLOWS, file), 'utf8')

    for (const [, id, body] of text.matchAll(JOB)) {
      if (!(body as string).includes('runs-on:')) {
        continue
      }

      const declared = /^ {4}name: (.+)$/m.exec(body as string)?.[1]?.trim()

      if (declared?.includes('${{')) {
        continue
      }

      names.push(declared ?? (id as string))
    }
  }

  return names
}

function requiredChecks(): string[] {
  const block = /required_checks = \[([\s\S]*?)\]/.exec(REPO_MAIN)?.[1] ?? ''

  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string)
}

describe('the checks a merge waits for', () => {
  const reported = checksEveryJobReports()

  it('found the jobs at all, so this is not passing on an empty list', () => {
    expect(workflowFiles().length).toBeGreaterThanOrEqual(8)
    expect(reported).toContain('Lint, typecheck, test, build')
  })

  it('requires only checks a workflow in this repository actually reports', () => {
    const required = requiredChecks()

    expect(required.length).toBeGreaterThan(0)
    for (const check of required) {
      expect(
        reported,
        `the ruleset requires ${JSON.stringify(check)}, which no job reports`,
      ).toContain(check)
    }
  })

  it('waits for the dependency check, which is what replaced the one that left', () => {
    expect(requiredChecks()).toContain('Dependencies')
  })
})

describe('what a private repository cannot run', () => {
  it('asks for nothing that needs GitHub Advanced Security, because there is none', () => {
    for (const file of workflowFiles()) {
      const text = readFileSync(join(WORKFLOWS, file), 'utf8')

      for (const absent of ADVANCED_SECURITY) {
        expect(
          text,
          `${file} uses ${absent}, which this repository cannot upload for`,
        ).not.toContain(absent)
      }
    }
  })
})
