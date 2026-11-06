import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOWS = join(ROOT, '.github', 'workflows')
const WORKFLOW = readFileSync(join(WORKFLOWS, 'release.yml'), 'utf8')

const MOST_MINUTES_ANY_JOB_MAY_TAKE = 30

function at(needle: string): number {
  const index = WORKFLOW.indexOf(needle)
  expect(index, `the release workflow has no ${JSON.stringify(needle)}`).toBeGreaterThan(-1)
  return index
}

describe('how a release reaches npm', () => {
  it('asks GitHub for an OIDC token, which is what trusted publishing is', () => {
    expect(WORKFLOW).toMatch(/^ {6}id-token: write$/m)
  })

  it('carries no npm credential at all, because there is none to leak', () => {
    expect(WORKFLOW).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|npmrc/i)
  })

  it('publishes only when the repository says it is time', () => {
    expect(WORKFLOW).toContain("vars.NPM_PUBLISH_ENABLED == 'true'")
  })

  it('runs only on main, where a merged Version Packages PR lands', () => {
    expect(WORKFLOW).toMatch(/branches: \[main\]/)
  })

  it('grants nothing by default and widens only inside the job', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read$/m)
  })

  it('pins every action to a commit, never to a tag someone else can move', () => {
    for (const [, reference] of WORKFLOW.matchAll(/uses: (\S+)/g)) {
      expect(reference, reference).toMatch(/@[0-9a-f]{40}$/)
    }
  })
})

describe('the order the steps have to run in', () => {
  it('builds before it publishes, because each package ships its dist and nothing else', () => {
    expect(at('run: pnpm build')).toBeLessThan(at('changesets/action'))
  })

  it('writes the bill of materials from the versions that are about to go out', () => {
    expect(at('pnpm run release:sbom')).toBeLessThan(at('changesets/action'))
  })

  it('attaches it afterwards, to the release of the package it describes', () => {
    expect(at('gh release upload')).toBeGreaterThan(at('changesets/action'))
    expect(WORKFLOW).toContain("steps.changesets.outputs.published == 'true'")
  })

  it('finds each document by what it says it describes, not by guessing a file name', () => {
    expect(WORKFLOW).toContain('cli.ts --json')
    expect(WORKFLOW).toContain('select(.name == $name)')
  })
})

describe('what a hung job is allowed to cost', () => {
  const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml'))

  it('found the workflows at all, so this is not passing on an empty list', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })

  it('gives every job a ceiling, because the default is six hours of metered minutes', () => {
    for (const file of files) {
      const text = readFileSync(join(WORKFLOWS, file), 'utf8')
      const jobs = [
        ...text.matchAll(/\n {2}([a-z][a-z0-9_-]*):\n((?: {4}\S[^\n]*\n|\n)*)/g),
      ].filter(([, , body]) => (body as string).includes('runs-on:'))

      expect(jobs.length, `${file} declares no job this test can see`).toBeGreaterThan(0)
      for (const [, name, body] of jobs) {
        const ceiling = /\n {4}timeout-minutes: (\d+)\n/.exec(body as string)

        expect(ceiling, `${file}: the job "${name}" has no timeout-minutes`).not.toBeNull()
        expect(Number(ceiling?.[1]), `${file}: ${name}`).toBeLessThanOrEqual(
          MOST_MINUTES_ANY_JOB_MAY_TAKE,
        )
      }
    }
  })
})
