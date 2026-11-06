import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MATRIX,
  may,
  mayActOn,
  mayGrant,
  needsThePasswordAgain,
  PERMISSIONS,
  type Permission,
  ROLES,
  type Role,
} from './permissions.ts'

const PLANO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'PLANO.md')

const ROWS: Readonly<Record<string, Permission>> = {
  'Ver logs, gráficos, traces e issues (todos os ambientes)': 'logs:read',
  'Criar views salvas e dashboards': 'views:write',
  'Mudar status e responsável de issues': 'issues:write',
  'Criar e editar regras de alerta': 'alert-rules:write',
  'Configurar canais de alerta (e-mail, Slack, Discord, webhook)': 'alert-channels:write',
  'Exportar logs (manual e agendada)': 'exports:write',
  'Criar e configurar projetos e ambientes': 'projects:write',
  'Criar, revogar e rotacionar keys': 'keys:write',
  'Convidar e remover membros e mudar papéis': 'members:write',
  'Ver o audit log': 'audit:read',
  'Apagar projetos (pedindo a senha de novo)': 'projects:delete',
  'Apagar a organização e transferir a propriedade': 'organization:delete',
}

type Cell = { permission: Permission; role: Role; allowed: boolean; label: string }

function tableInThePlan(): Cell[] {
  const document = readFileSync(PLANO, 'utf8')
  const section = document.slice(
    document.indexOf('### 10.2'),
    document.indexOf('\n---', document.indexOf('### 10.2')),
  )
  const cells: Cell[] = []

  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) {
      continue
    }
    const columns = line
      .split('|')
      .slice(1, -1)
      .map((column) => column.trim())

    const label = columns[0] as string
    const permission = ROWS[label]
    if (permission === undefined || columns.length !== 5) {
      continue
    }

    for (const [at, role] of ROLES.entries()) {
      cells.push({
        permission,
        role,
        allowed: (columns[at + 1] as string).includes('✓'),
        label,
      })
    }
  }

  return cells
}

const CELLS = tableInThePlan()

describe('the table in section 10.2 of the plan', () => {
  it('was read in full, so none of this is passing on an empty table', () => {
    expect(CELLS).toHaveLength(PERMISSIONS.length * ROLES.length)
    expect(new Set(CELLS.map((cell) => cell.permission)).size).toBe(PERMISSIONS.length)
  })

  it('names the same roles the code does, in the same order', () => {
    const document = readFileSync(PLANO, 'utf8')

    expect(document).toContain('| Ação | owner | admin | member | viewer |')
    expect([...ROLES]).toEqual(['owner', 'admin', 'member', 'viewer'])
  })

  it.each(CELLS)('$label is $allowed for $role', ({ permission, role, allowed }) => {
    expect(may(role, permission)).toBe(allowed)
  })

  it('leaves no permission in the code that the plan does not list', () => {
    expect([...PERMISSIONS].sort()).toEqual([...new Set(Object.values(ROWS))].sort())
  })
})

describe('what a role cannot do whatever the table says', () => {
  it('gives nothing at all to somebody with no membership', () => {
    for (const permission of PERMISSIONS) {
      expect(may(undefined, permission), permission).toBe(false)
    }
  })

  it('stops an admin from touching an owner, which is the footnote', () => {
    expect(mayActOn('admin', 'owner')).toBe(false)
    expect(mayActOn('admin', 'admin')).toBe(true)
    expect(mayActOn('admin', 'member')).toBe(true)
    expect(mayActOn('owner', 'owner')).toBe(true)
  })

  it('stops an admin from promoting anybody to owner, which is the rest of it', () => {
    expect(mayGrant('admin', 'owner')).toBe(false)
    expect(mayGrant('admin', 'admin')).toBe(true)
    expect(mayGrant('owner', 'owner')).toBe(true)
  })

  it('gives a member and a viewer no say over anybody', () => {
    for (const actor of ['member', 'viewer'] as const) {
      for (const target of ROLES) {
        expect(mayActOn(actor, target), `${actor} over ${target}`).toBe(false)
        expect(mayGrant(actor, target), `${actor} granting ${target}`).toBe(false)
      }
    }
  })

  it('asks for the password again before the two deletions the plan marks', () => {
    expect(needsThePasswordAgain('projects:delete')).toBe(true)
    expect(needsThePasswordAgain('organization:delete')).toBe(true)
    expect(needsThePasswordAgain('keys:write')).toBe(false)
  })
})

describe('the shape of the matrix itself', () => {
  it('lists every permission exactly once, with no role repeated', () => {
    for (const permission of PERMISSIONS) {
      const roles = MATRIX[permission]

      expect(new Set(roles).size, permission).toBe(roles.length)
      for (const role of roles) {
        expect(ROLES, `${permission} names ${role}`).toContain(role)
      }
    }
  })

  it('never gives a narrower role something a wider one does not have', () => {
    const width: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 }

    for (const permission of PERMISSIONS) {
      for (const role of ROLES) {
        if (!may(role, permission)) {
          continue
        }
        for (const wider of ROLES.filter((other) => width[other] > width[role])) {
          expect(may(wider, permission), `${wider} lacks what ${role} has: ${permission}`).toBe(
            true,
          )
        }
      }
    }
  })
})
