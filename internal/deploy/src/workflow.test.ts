import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readJsonObject } from './config.ts'
import { placeholdersIn } from './render.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-workers.yml'), 'utf8')

function appsWithAWranglerConfig(): string[] {
  return readdirSync(join(ROOT, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        readJsonObject(join(ROOT, 'apps', name, 'wrangler.json'))
        return true
      } catch {
        return false
      }
    })
    .sort()
}

const APPS = appsWithAWranglerConfig()

function placeholdersOf(app: string): string[] {
  return [...placeholdersIn(readJsonObject(join(ROOT, 'apps', app, 'wrangler.json')))].sort()
}

function matrixApps(): string[] {
  return [...WORKFLOW.matchAll(/app: \[([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '')
}

describe('the workflow that compiles and deploys every Worker', () => {
  it('knows about every app that has a wrangler config, in both jobs', () => {
    const matrices = [...WORKFLOW.matchAll(/app: \[([^\]]+)\]/g)]

    expect(matrices.length).toBe(2)
    for (const matrix of matrices) {
      const named = (matrix[1] ?? '')
        .split(',')
        .map((name) => name.trim())
        .sort()
      expect(named).toEqual(APPS)
    }
  })

  it('supplies every placeholder each config asks for, in the dry run and in the deploy', () => {
    const needed = new Set(APPS.flatMap((app) => placeholdersOf(app)))

    expect(needed.size).toBeGreaterThan(0)
    for (const name of needed) {
      const supplied = [...WORKFLOW.matchAll(new RegExp(`^\\s+${name}: `, 'gm'))]

      expect(
        supplied.length,
        `${name} is a placeholder in a wrangler.json but the workflow sets it ${supplied.length} time(s), not twice`,
      ).toBe(2)
    }
  })

  it('names no app in the matrix that has no wrangler config', () => {
    for (const app of matrixApps()) {
      expect(APPS, `${app} is in the matrix but has no wrangler.json`).toContain(app)
    }
  })

  it('still deploys nothing unless somebody turns it on', () => {
    expect(WORKFLOW).toContain("vars.WORKERS_DEPLOY_ENABLED == 'true'")
  })
})
