import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')

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
