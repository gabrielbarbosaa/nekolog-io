import 'server-only'
import {
  type Environment,
  justLooking,
  listEnvironments,
  listProjects,
  type Organization,
  organizationsOf,
  type Project,
} from '@internal/auth'
import { redirect } from 'next/navigation'
import { loginDeps } from './auth'
import { currentSession } from './session'

export type Signed = {
  userId: string
  organizations: Organization[]
  justLooking: boolean
}

export async function signedIn(): Promise<Signed> {
  const claims = await currentSession()
  if (claims === undefined) {
    redirect('/login')
  }

  const run = loginDeps().run

  return {
    userId: claims.sub,
    organizations: await organizationsOf(run, claims.sub),
    justLooking: await justLooking(run, claims.sub),
  }
}

export async function organizationOr404(
  signed: Signed,
  organizationId: string,
): Promise<Organization> {
  const found = signed.organizations.find((one) => one.id === organizationId)
  if (found === undefined) {
    redirect('/')
  }
  return found
}

export async function projectsOf(organizationId: string): Promise<Project[]> {
  return listProjects(loginDeps().run, organizationId)
}

export async function environmentsOf(
  organizationId: string,
  projectId: string,
): Promise<Environment[]> {
  return listEnvironments(loginDeps().run, organizationId, projectId)
}
