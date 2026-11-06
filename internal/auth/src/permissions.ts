export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'logs:read',
  'views:write',
  'issues:write',
  'alert-rules:write',
  'alert-channels:write',
  'exports:write',
  'projects:write',
  'keys:write',
  'members:write',
  'audit:read',
  'projects:delete',
  'organization:delete',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const EVERYONE: readonly Role[] = ['owner', 'admin', 'member', 'viewer']
const CONTRIBUTORS: readonly Role[] = ['owner', 'admin', 'member']
const ADMINISTRATORS: readonly Role[] = ['owner', 'admin']
const OWNERS: readonly Role[] = ['owner']

export const MATRIX: Readonly<Record<Permission, readonly Role[]>> = {
  'logs:read': EVERYONE,
  'views:write': CONTRIBUTORS,
  'issues:write': CONTRIBUTORS,
  'alert-rules:write': CONTRIBUTORS,
  'alert-channels:write': ADMINISTRATORS,
  'exports:write': ADMINISTRATORS,
  'projects:write': ADMINISTRATORS,
  'keys:write': ADMINISTRATORS,
  'members:write': ADMINISTRATORS,
  'audit:read': ADMINISTRATORS,
  'projects:delete': ADMINISTRATORS,
  'organization:delete': OWNERS,
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

export function may(role: Role | undefined, permission: Permission): boolean {
  return role !== undefined && MATRIX[permission].includes(role)
}

export function mayActOn(actor: Role, target: Role): boolean {
  if (!may(actor, 'members:write')) {
    return false
  }
  return actor === 'owner' || target !== 'owner'
}

export function mayGrant(actor: Role, role: Role): boolean {
  if (!may(actor, 'members:write')) {
    return false
  }
  return actor === 'owner' || role !== 'owner'
}

export function needsThePasswordAgain(permission: Permission): boolean {
  return permission === 'projects:delete' || permission === 'organization:delete'
}
