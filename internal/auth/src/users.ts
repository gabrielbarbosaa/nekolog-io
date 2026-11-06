export type SqlRunner = (
  text: string,
  params: readonly unknown[],
) => Promise<ReadonlyArray<Record<string, unknown>>>

export type Account = {
  id: string
  email: string
  name: string
  passwordHash: string
  emailVerifiedAt: Date | undefined
  suspendedAt: Date | undefined
  locale: string
  timezone: string
}

const FIND_BY_EMAIL = `
  select id, email, name, password_hash, email_verified_at, suspended_at, locale, timezone
  from users
  where email = $1
  limit 1
`

const SET_PASSWORD = `
  update users
  set password_hash = $2, password_changed_at = now()
  where id = $1
`

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

function dateOf(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value
  }
  return typeof value === 'string' ? new Date(value) : undefined
}

function accountFrom(row: Record<string, unknown>): Account {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    passwordHash: String(row.password_hash),
    emailVerifiedAt: dateOf(row.email_verified_at),
    suspendedAt: dateOf(row.suspended_at),
    locale: String(row.locale),
    timezone: String(row.timezone),
  }
}

export async function findAccountByEmail(
  run: SqlRunner,
  email: string,
): Promise<Account | undefined> {
  const rows = await run(FIND_BY_EMAIL, [normalizeEmail(email)])
  const row = rows[0]
  return row === undefined ? undefined : accountFrom(row)
}

export async function setPasswordHash(
  run: SqlRunner,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await run(SET_PASSWORD, [userId, passwordHash])
}

export function mayHoldASession(account: Account): boolean {
  return account.emailVerifiedAt !== undefined && account.suspendedAt === undefined
}
