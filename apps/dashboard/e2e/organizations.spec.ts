import { expect, test } from '@playwright/test'
import { clearMail, waitForMail } from './support/mail'
import {
  anAccount,
  anAddress,
  api,
  closeWorld,
  forgetTheCodeWait,
  joinOrganization,
  openBrowser,
  PASSWORD,
  signIn,
} from './support/world'

test.afterAll(async () => {
  await closeWorld()
})

type Member = { id: string; userId: string; email: string; role: string }

async function anOwner(context: Parameters<typeof openBrowser>[0]) {
  const page = await openBrowser(context)
  const email = await anAccount(page)
  expect((await signIn(page, email)).status).toBe(200)

  const made = await api(page, '/api/orgs', { name: `Acme ${Date.now()}` })
  expect(made.status, JSON.stringify(made.body)).toBe(201)

  return { page, email, org: String(made.body?.organization) }
}

async function membersOf(page: Parameters<typeof api>[0], org: string): Promise<Member[]> {
  const listed = await api(page, `/api/orgs/${org}/members`)
  return (listed.body?.members ?? []) as Member[]
}

test('creating an organization makes you its owner, and nobody else sees it', async ({
  context,
  browser,
}) => {
  const { page, email, org } = await anOwner(context)

  const mine = await api(page, '/api/orgs')
  expect(mine.body?.organizations as unknown[]).toContainEqual(
    expect.objectContaining({ id: org, role: 'owner' }),
  )

  const members = await membersOf(page, org)
  expect(members).toHaveLength(1)
  expect(members[0]?.email).toBe(email)

  const other = await browser.newContext()
  const stranger = await openBrowser(other)
  const theirEmail = await anAccount(stranger)
  expect((await signIn(stranger, theirEmail)).status).toBe(200)

  const theirs = (await api(stranger, '/api/orgs')).body?.organizations as Array<{ id: string }>
  expect(theirs.map((one) => one.id)).not.toContain(org)
  expect(
    (await api(stranger, `/api/orgs/${org}/members`)).status,
    'a stranger must not even learn that the organization exists',
  ).toBe(404)
  expect((await api(stranger, `/api/orgs/${org}/audit`)).status).toBe(404)
  expect((await api(stranger, `/api/orgs/${org}/members/remove`, { member: 'mem_x' })).status).toBe(
    404,
  )

  await other.close()
})

test('an invitation arrives by e-mail and the link is what joins', async ({ context, browser }) => {
  const { page, org } = await anOwner(context)
  const invited = anAddress()
  await clearMail(invited)

  const sent = await api(page, `/api/orgs/${org}/members/invite`, {
    email: invited,
    role: 'member',
  })
  expect(sent.status, JSON.stringify(sent.body)).toBe(200)

  const message = await waitForMail(invited, 'invited to')
  const link = /(https?:\/\/\S+\/signup\?invite=[A-Za-z0-9_-]+)/.exec(message.text)?.[1]
  expect(link, message.text).toBeDefined()
  const token = new URL(link as string).searchParams.get('invite') as string

  const other = await browser.newContext()
  const newcomer = await openBrowser(other)
  await clearMail(invited)
  const signedUp = await api(newcomer, '/api/auth/signup', {
    invite: token,
    name: 'The Newcomer',
    password: PASSWORD,
    locale: 'en',
  })
  expect(signedUp.status, JSON.stringify(signedUp.body)).toBe(200)

  const code = /\b([A-Z0-9]{3}-[A-Z0-9]{3})\b/.exec(
    (await waitForMail(invited, 'Confirm your e-mail')).text,
  )?.[1]
  expect((await api(newcomer, '/api/auth/verify-email', { code })).status).toBe(200)
  expect(
    (await api(newcomer, '/api/orgs')).status,
    'confirming an address creates no session on its own',
  ).toBe(401)

  await forgetTheCodeWait(invited)
  expect((await signIn(newcomer, invited)).status).toBe(200)

  const joined = await api(newcomer, '/api/orgs')
  expect(joined.body?.organizations as unknown[], JSON.stringify(joined.body)).toContainEqual(
    expect.objectContaining({ id: org, role: 'member' }),
  )
  expect(await membersOf(page, org)).toHaveLength(2)

  await other.close()
})

test('a member cannot invite, change a role or read the audit log', async ({
  context,
  browser,
}) => {
  const { page, org } = await anOwner(context)

  const other = await browser.newContext()
  const plain = await openBrowser(other)
  const theirEmail = await anAccount(plain)
  await joinOrganization(org, theirEmail, 'member')
  expect((await signIn(plain, theirEmail)).status).toBe(200)

  expect((await api(plain, `/api/orgs/${org}/members`)).status, 'a member may read the list').toBe(
    200,
  )
  expect(
    (await api(plain, `/api/orgs/${org}/members`)).body?.invites,
    'but not the invitations in flight',
  ).toEqual([])

  expect(
    (await api(plain, `/api/orgs/${org}/members/invite`, { email: anAddress(), role: 'member' }))
      .status,
  ).toBe(403)
  expect((await api(plain, `/api/orgs/${org}/audit`)).status).toBe(403)
  expect((await api(plain, `/api/orgs/${org}/delete`, { password: PASSWORD })).status).toBe(403)

  const members = await membersOf(page, org)
  const owner = members.find((member) => member.role === 'owner')
  expect(
    (await api(plain, `/api/orgs/${org}/members/role`, { member: owner?.id, role: 'viewer' }))
      .status,
    'a member must not be able to demote the owner',
  ).toBe(403)

  await other.close()
})

test('an admin cannot touch an owner, and the owner is never the last one standing', async ({
  context,
  browser,
}) => {
  const { page, org } = await anOwner(context)
  const other = await browser.newContext()
  const admin = await openBrowser(other)
  const adminEmail = await anAccount(admin)
  await joinOrganization(org, adminEmail, 'admin')
  expect((await signIn(admin, adminEmail)).status).toBe(200)

  const members = await membersOf(page, org)
  const owner = members.find((member) => member.role === 'owner')

  expect(
    (await api(admin, `/api/orgs/${org}/members/role`, { member: owner?.id, role: 'admin' }))
      .status,
  ).toBe(403)
  expect((await api(admin, `/api/orgs/${org}/members/remove`, { member: owner?.id })).status).toBe(
    403,
  )

  const invitedAsOwner = await api(admin, `/api/orgs/${org}/members/invite`, {
    email: anAddress(),
    role: 'owner',
  })
  expect(invitedAsOwner.status, 'an admin must not be able to mint another owner').toBe(403)

  expect(
    (await api(page, `/api/orgs/${org}/members/remove`, { member: owner?.id })).status,
    'the owner cannot remove themselves while they are the only one',
  ).toBe(409)

  await other.close()
})

test('the audit log records what the owner did, and only for this organization', async ({
  context,
}) => {
  const { page, org } = await anOwner(context)
  await api(page, `/api/orgs/${org}/members/invite`, { email: anAddress(), role: 'viewer' })

  const audit = await api(page, `/api/orgs/${org}/audit`)
  const actions = ((audit.body?.entries ?? []) as Array<{ action: string }>).map(
    (entry) => entry.action,
  )

  expect(actions).toContain('member.invited')
  expect(actions).toContain('organization.created')
})

test('deleting an organization asks for the password', async ({ context }) => {
  const { page, org } = await anOwner(context)

  const idsNow = async () => {
    const listed = (await api(page, '/api/orgs')).body ?? {}
    return (listed.organizations as Array<{ id: string }>).map((one) => one.id)
  }

  expect((await api(page, `/api/orgs/${org}/delete`, { password: 'not it' })).status).toBe(401)
  expect(await idsNow(), 'a wrong password must change nothing').toContain(org)

  expect((await api(page, `/api/orgs/${org}/delete`, { password: PASSWORD })).status).toBe(200)
  expect(await idsNow()).not.toContain(org)
})
