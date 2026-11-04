import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_STALE_AFTER_MS,
  EXPORT_LIFETIME_DAYS,
  type SqlRunner,
  sqlExportScheduleStore,
  sqlExportStore,
} from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const DATABASE = `nekolog_exports_${process.pid}`

async function answers(): Promise<boolean> {
  const admin = postgres(URL, { max: 1, idle_timeout: 1, connect_timeout: 3, onnotice: () => {} })
  try {
    await admin`select 1`
    return true
  } catch {
    return false
  } finally {
    await admin.end({ timeout: 1 })
  }
}

const reachable = await answers()

if (!reachable) {
  if (process.env.POSTGRES_TEST_REQUIRED === '1') {
    throw new Error(
      `POSTGRES_TEST_REQUIRED is set but nothing answered at ${URL}. ` +
        'These tests must not be skipped here.',
    )
  }
  process.stderr.write(
    `\nSkipping the export store integration tests: nothing answered at ${URL}.\n` +
      'Start the dev stack with `pnpm dev:infra` first.\n\n',
  )
}

function migrationStatements(): string[] {
  const directory = join(PACKAGE, 'migrations')
  return readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(directory, file), 'utf8').split('--> statement-breakpoint'),
    )
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let counter = 0

function id(prefix: string): string {
  counter += 1
  let suffix = ''
  for (let position = 0; position < 26; position += 1) {
    suffix += CROCKFORD[(counter * 13 + position * 5) % 32]
  }
  return `${prefix}${suffix}`
}

let sql: postgres.Sql
let run: SqlRunner
let projectId: string
let production: string
let staging: string
let userId: string

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)

async function add(overrides: Record<string, unknown> = {}): Promise<string> {
  const exportId = id('exp_')
  await sql`insert into exports ${sql({
    id: exportId,
    project_id: projectId,
    environment_id: production,
    format: 'csv',
    range_from: new Date(NOW - DAY),
    range_to: new Date(NOW),
    expires_at: new Date(NOW + EXPORT_LIFETIME_DAYS * DAY),
    created_at: new Date(NOW - 1000),
    ...overrides,
  })}`
  return exportId
}

async function statusOf(exportId: string): Promise<Record<string, unknown> | undefined> {
  const rows = await sql`select * from exports where id = ${exportId}`
  return rows[0]
}

beforeAll(async () => {
  if (!reachable) {
    return
  }

  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`create database "${DATABASE}"`)
  } finally {
    await admin.end()
  }

  sql = postgres(URL.replace(/\/[^/]*$/, `/${DATABASE}`), { max: 1, onnotice: () => {} })
  for (const statement of migrationStatements()) {
    await sql.unsafe(statement)
  }

  run = async (text, params) => sql.unsafe(text, params as never[])

  const organizationId = id('org_')
  projectId = id('prj_')
  production = id('env_')
  staging = id('env_')
  userId = id('usr_')

  await sql`insert into users ${sql({
    id: userId,
    name: 'Reader',
    email: 'reader@example.com',
    password_hash: 'x'.repeat(60),
    email_verified_at: new Date(NOW - 90 * DAY),
    locale: 'pt-BR',
  })}`
  await sql`insert into organizations ${sql({ id: organizationId, name: 'Acme' })}`
  await sql`insert into projects ${sql({ id: projectId, organization_id: organizationId, name: 'web' })}`
  await sql`insert into environments ${sql({ id: production, project_id: projectId, name: 'production' })}`
  await sql`insert into environments ${sql({ id: staging, project_id: projectId, name: 'staging' })}`
}, 60_000)

afterAll(async () => {
  await sql?.end()
  const admin = postgres(URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists "${DATABASE}" with (force)`)
  } finally {
    await admin.end()
  }
})

async function clear(): Promise<void> {
  await sql`delete from exports where project_id = ${projectId}`
}

describe.skipIf(!reachable)('the SQL export store against a real Postgres', () => {
  it('claims a pending export exactly once', async () => {
    await clear()
    const store = sqlExportStore(run)
    const exportId = await add()

    const first = await store.claim(10, NOW)
    const second = await store.claim(10, NOW)

    expect(first.map((one) => one.id)).toEqual([exportId])
    expect(second).toEqual([])
    expect(await statusOf(exportId)).toMatchObject({ status: 'running' })
  })

  it('hands back the period as milliseconds the query builder can use', async () => {
    await clear()
    const store = sqlExportStore(run)
    await add()

    const [claimed] = await store.claim(10, NOW)

    expect(claimed?.rangeFrom).toBe(NOW - DAY)
    expect(claimed?.rangeTo).toBe(NOW)
    expect(claimed?.environmentId).toBe(production)
  })

  it('takes back an export whose run plainly died, and only then', async () => {
    await clear()
    const store = sqlExportStore(run)
    const stuck = await add({
      status: 'running',
      started_at: new Date(NOW - DEFAULT_STALE_AFTER_MS - 1000),
    })
    await add({ status: 'running', started_at: new Date(NOW - 1000) })

    expect((await store.claim(10, NOW)).map((one) => one.id)).toEqual([stuck])
  })

  it('writes what the export produced, and the database accepts it as ready', async () => {
    await clear()
    const store = sqlExportStore(run)
    const exportId = await add()
    await store.claim(10, NOW)

    await store.markReady(
      exportId,
      { objectKey: `exports/${exportId}.csv.gz`, byteSize: 128, rowCount: 4 },
      NOW,
    )

    expect(await statusOf(exportId)).toMatchObject({
      status: 'ready',
      object_key: `exports/${exportId}.csv.gz`,
      byte_size: '128',
      row_count: '4',
      failure: null,
    })
  })

  it('cannot mark an export ready without an object, because the schema says so', async () => {
    await clear()
    const exportId = await add()

    await expect(sql`update exports set status = 'ready' where id = ${exportId}`).rejects.toThrow(
      /exports_ready_means_there_is_an_object/,
    )
  })

  it('cannot mark an export running without saying when it started', async () => {
    await clear()
    const exportId = await add()

    await expect(sql`update exports set status = 'running' where id = ${exportId}`).rejects.toThrow(
      /exports_running_means_it_started/,
    )
  })

  it('records a failure with its reason', async () => {
    await clear()
    const store = sqlExportStore(run)
    const exportId = await add()
    await store.claim(10, NOW)

    await store.markFailed(exportId, 'ClickHouse refused the write', NOW)

    expect(await statusOf(exportId)).toMatchObject({
      status: 'failed',
      failure: 'ClickHouse refused the write',
      object_key: null,
    })
  })

  it('leaves an export alone when the run that finishes it never claimed it', async () => {
    await clear()
    const store = sqlExportStore(run)
    const exportId = await add()

    await store.markReady(
      exportId,
      { objectKey: 'exports/x.csv.gz', byteSize: 1, rowCount: 1 },
      NOW,
    )

    expect(await statusOf(exportId)).toMatchObject({ status: 'pending', object_key: null })
  })

  it('expires what is past its date and names the objects to delete', async () => {
    await clear()
    const store = sqlExportStore(run)
    const old = await add({
      status: 'ready',
      object_key: 'exports/old.csv.gz',
      created_at: new Date(NOW - 9 * DAY),
      expires_at: new Date(NOW - 1000),
    })
    const fresh = await add({
      status: 'ready',
      object_key: 'exports/fresh.csv.gz',
      expires_at: new Date(NOW + DAY),
    })

    expect(await store.expire(NOW, 10)).toEqual(['exports/old.csv.gz'])
    expect(await statusOf(old)).toMatchObject({ status: 'expired' })
    expect(await statusOf(fresh)).toMatchObject({ status: 'ready' })
  })

  it('refuses an object key that would climb out of the exports prefix', async () => {
    await clear()
    const exportId = await add()

    await expect(
      sql`update exports set status = 'pending', object_key = ${'exports/../secrets'} where id = ${exportId}`,
    ).rejects.toThrow(/exports_object_key/)
  })

  it('offers a scheduled export for notice once it is ready, with the reader locale', async () => {
    await clear()
    await sql`delete from export_schedules where project_id = ${projectId}`
    const store = sqlExportStore(run)
    const scheduleId = id('exs_')
    await sql`insert into export_schedules ${sql({
      id: scheduleId,
      project_id: projectId,
      environment_id: production,
      cadence: 'daily',
      format: 'csv',
    })}`
    const exportId = await add({
      schedule_id: scheduleId,
      requested_by: userId,
      status: 'ready',
      object_key: 'exports/a.csv.gz',
      row_count: 7,
      byte_size: 1024,
    })

    const [waiting] = await store.awaitingNotice(10)

    expect(waiting).toMatchObject({
      id: exportId,
      cadence: 'daily',
      locale: 'pt-BR',
      email: 'reader@example.com',
      rowCount: 7,
      byteSize: 1024,
    })
    expect(waiting?.rangeFrom).toBe(NOW - DAY)
  })

  it('offers it only once, and never for an export nobody asked for', async () => {
    await clear()
    await sql`delete from export_schedules where project_id = ${projectId}`
    const store = sqlExportStore(run)
    const scheduleId = id('exs_')
    await sql`insert into export_schedules ${sql({
      id: scheduleId,
      project_id: projectId,
      environment_id: production,
      cadence: 'daily',
      format: 'csv',
    })}`
    const exportId = await add({
      schedule_id: scheduleId,
      requested_by: userId,
      status: 'ready',
      object_key: 'exports/a.csv.gz',
    })
    await add({ status: 'ready', object_key: 'exports/b.csv.gz' })

    expect((await store.awaitingNotice(10)).map((one) => one.id)).toEqual([exportId])

    await store.markNotified(exportId, NOW)

    expect(await store.awaitingNotice(10)).toEqual([])
  })

  it('cannot record a notice for an export with no file, because the schema says so', async () => {
    await clear()
    const exportId = await add()

    await expect(
      sql`update exports set notified_at = now() where id = ${exportId}`,
    ).rejects.toThrow(/exports_notice_follows_the_file/)
  })

  it('refuses a row whose environment belongs to another project', async () => {
    await clear()
    const other = id('prj_')
    const organizationId = (
      await sql`select organization_id from projects where id = ${projectId}`
    )[0]?.organization_id as string
    await sql`insert into projects ${sql({ id: other, organization_id: organizationId, name: 'other' })}`

    await expect(add({ project_id: other, environment_id: production })).rejects.toThrow(
      /exports_environment_belongs_to_the_project/,
    )
  })

  it('never offers a notice to a reader who was suspended or never verified', async () => {
    await clear()
    await sql`delete from export_schedules where project_id = ${projectId}`
    const store = sqlExportStore(run)
    const scheduleId = id('exs_')
    await sql`insert into export_schedules ${sql({
      id: scheduleId,
      project_id: projectId,
      environment_id: production,
      cadence: 'daily',
      format: 'csv',
    })}`
    await add({
      schedule_id: scheduleId,
      requested_by: userId,
      status: 'ready',
      object_key: 'exports/a.csv.gz',
    })

    expect(await store.awaitingNotice(10)).toHaveLength(1)

    await sql`update users set suspended_at = now() where id = ${userId}`
    expect(await store.awaitingNotice(10)).toEqual([])

    await sql`update users set suspended_at = null, email_verified_at = null where id = ${userId}`
    expect(await store.awaitingNotice(10)).toEqual([])

    await sql`update users set email_verified_at = now() where id = ${userId}`
    expect(await store.awaitingNotice(10)).toHaveLength(1)
  })

  it('takes the oldest first when there is not room for every one of them', async () => {
    await clear()
    const store = sqlExportStore(run)
    const older = await add({ created_at: new Date(NOW - 9000), environment_id: staging })
    await add({ created_at: new Date(NOW - 1000) })

    expect((await store.claim(1, NOW)).map((one) => one.id)).toEqual([older])
  })

  it('claims an export the schedule store queued, like any other', async () => {
    await clear()
    await sql`delete from export_schedules where project_id = ${projectId}`
    const schedules = sqlExportScheduleStore(run)
    const store = sqlExportStore(run)
    const scheduleId = id('exs_')
    const exportId = id('exp_')
    await sql`insert into export_schedules ${sql({
      id: scheduleId,
      project_id: projectId,
      environment_id: production,
      cadence: 'daily',
      format: 'csv',
      created_by: userId,
      created_at: new Date(NOW - 30 * DAY),
    })}`

    await schedules.enqueue({
      scheduleId,
      exportId,
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    expect((await store.claim(10, NOW)).map((one) => one.id)).toEqual([exportId])
  })

  it('claims across environments, because it claims by age and not by project', async () => {
    await clear()
    const store = sqlExportStore(run)
    const inStaging = await add({ environment_id: staging })
    const inProduction = await add()

    const claimed = await store.claim(10, NOW)

    expect([...claimed.map((one) => one.id)].sort()).toEqual([inProduction, inStaging].sort())
    expect(claimed.map((one) => one.environmentId).sort()).toEqual([production, staging].sort())
  })
})

describe.skipIf(!reachable)('the SQL export schedule store against a real Postgres', () => {
  async function addSchedule(overrides: Record<string, unknown> = {}): Promise<string> {
    const scheduleId = id('exs_')
    await sql`insert into export_schedules ${sql({
      id: scheduleId,
      project_id: projectId,
      environment_id: production,
      cadence: 'daily',
      format: 'csv',
      created_by: userId,
      created_at: new Date(NOW - 30 * DAY),
      ...overrides,
    })}`
    return scheduleId
  }

  async function clearSchedules(): Promise<void> {
    await sql`delete from exports where project_id = ${projectId}`
    await sql`delete from export_schedules where project_id = ${projectId}`
  }

  it('finds a schedule whose period has closed since it last ran', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule({ last_run_at: new Date(NOW - 2 * DAY) })
    const schedules = sqlExportScheduleStore(run)

    expect((await schedules.due('daily', NOW, 10)).map((one) => one.id)).toEqual([scheduleId])
  })

  it('leaves a schedule alone when it already ran for this period', async () => {
    await clearSchedules()
    await addSchedule({ last_run_at: new Date(NOW + 1000) })
    const schedules = sqlExportScheduleStore(run)

    expect(await schedules.due('daily', NOW, 10)).toEqual([])
  })

  it('leaves a schedule alone when it is younger than the period it would export', async () => {
    await clearSchedules()
    await addSchedule({ created_at: new Date(NOW + 1000) })
    const schedules = sqlExportScheduleStore(run)

    expect(await schedules.due('daily', NOW, 10)).toEqual([])
  })

  it('never offers a disabled schedule, or one of another cadence', async () => {
    await clearSchedules()
    await addSchedule({ disabled_at: new Date(NOW - DAY) })
    await addSchedule({ cadence: 'weekly', environment_id: staging })
    const schedules = sqlExportScheduleStore(run)

    expect(await schedules.due('daily', NOW, 10)).toEqual([])
    expect(await schedules.due('weekly', NOW, 10)).toHaveLength(1)
  })

  it('queues the export and stamps the schedule in one statement', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule()
    const schedules = sqlExportScheduleStore(run)
    const exportId = id('exp_')

    const queued = await schedules.enqueue({
      scheduleId,
      exportId,
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    const row = await statusOf(exportId)
    const [stamped] = await sql`select last_run_at from export_schedules where id = ${scheduleId}`

    expect(queued).toBe(true)
    expect(row).toMatchObject({
      status: 'pending',
      schedule_id: scheduleId,
      requested_by: userId,
      format: 'csv',
    })
    expect(new Date(stamped?.last_run_at as string).getTime()).toBe(NOW)
  })

  it('queues nothing the second time, so a period cannot be exported twice', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule()
    const schedules = sqlExportScheduleStore(run)

    const first = await schedules.enqueue({
      scheduleId,
      exportId: id('exp_'),
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })
    const second = await schedules.enqueue({
      scheduleId,
      exportId: id('exp_'),
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    const rows =
      await sql`select count(*)::int as total from exports where schedule_id = ${scheduleId}`

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(rows[0]?.total).toBe(1)
  })

  it('queues nothing for a schedule created after the period it would export closed', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule({ created_at: new Date(NOW + 1000) })
    const schedules = sqlExportScheduleStore(run)

    const queued = await schedules.enqueue({
      scheduleId,
      exportId: id('exp_'),
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    expect(queued).toBe(false)
  })

  it('queues nothing for a schedule that already ran for this period', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule({ last_run_at: new Date(NOW + 1000) })
    const schedules = sqlExportScheduleStore(run)

    const queued = await schedules.enqueue({
      scheduleId,
      exportId: id('exp_'),
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    expect(queued).toBe(false)
  })

  it('queues nothing for a schedule that was disabled between finding it and running it', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule()
    await sql`update export_schedules set disabled_at = now() where id = ${scheduleId}`
    const schedules = sqlExportScheduleStore(run)

    const queued = await schedules.enqueue({
      scheduleId,
      exportId: id('exp_'),
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    expect(queued).toBe(false)
  })

  it('carries the schedule filter onto the export it queues', async () => {
    await clearSchedules()
    const scheduleId = await addSchedule({ query: 'level:error' })
    const schedules = sqlExportScheduleStore(run)
    const exportId = id('exp_')

    await schedules.enqueue({
      scheduleId,
      exportId,
      rangeFrom: NOW - DAY,
      rangeTo: NOW,
      expiresAt: NOW + EXPORT_LIFETIME_DAYS * DAY,
      stampedAt: NOW,
    })

    expect(await statusOf(exportId)).toMatchObject({ query: 'level:error' })
  })
})
