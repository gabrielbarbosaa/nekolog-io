import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  newChannelSecret,
  type SqlRunner,
  sealSecret,
  sqlAlertChannelStore,
  sqlAlertNoticeStore,
  sqlAlertRuleStore,
  sqlIssueActivity,
} from '@nekolog-io/adapters'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..')

const URL = process.env.POSTGRES_TEST_URL ?? 'postgres://nekolog:nekolog@localhost:5432/nekolog_dev'
const DATABASE = `nekolog_alerts_${process.pid}`

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
    `\nSkipping the alert rule store integration tests: nothing answered at ${URL}.\n` +
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
    suffix += CROCKFORD[(counter * 17 + position * 3) % 32]
  }
  return `${prefix}${suffix}`
}

let sql: postgres.Sql
let run: SqlRunner
let projectId: string
let production: string
let staging: string

const CHANNEL = 'ch_01JBQ8R4T7V2WXYZ0123456789'
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0)
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

function condition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'threshold',
    query: 'level:error',
    window: '5m',
    operator: '>',
    value: 50,
    cooldown: '30m',
    channels: [CHANNEL],
    ...overrides,
  }
}

async function addRule(overrides: Record<string, unknown> = {}): Promise<string> {
  const ruleId = id('alr_')
  const { condition: given, ...rest } = overrides
  const body = (given ?? condition()) as Record<string, unknown>

  await sql`insert into alert_rules ${sql({
    id: ruleId,
    project_id: projectId,
    environment_id: production,
    name: ruleId,
    type: 'threshold',
    ...rest,
    condition: body,
  })}`
  return ruleId
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
  await sql`delete from alert_rules where project_id = ${projectId}`
}

describe.skipIf(!reachable)('the alert rules table', () => {
  it('refuses a condition whose type disagrees with the column', async () => {
    await clear()

    await expect(
      addRule({ type: 'absence', condition: condition({ type: 'threshold' }) }),
    ).rejects.toThrow(/alert_rules_condition_names_the_same_type/)
  })

  it('refuses a condition that names an environment, because the column is the truth', async () => {
    await clear()

    await expect(addRule({ condition: condition({ environment: 'production' }) })).rejects.toThrow(
      /alert_rules_condition_carries_no_environment/,
    )
  })

  it('refuses a rule with no channel, which could never tell anybody', async () => {
    await clear()

    await expect(addRule({ condition: condition({ channels: [] }) })).rejects.toThrow(
      /alert_rules_condition_has_channels/,
    )
  })

  it('refuses a condition that is not an object at all', async () => {
    await clear()

    await expect(addRule({ condition: ['threshold'] })).rejects.toThrow(
      /alert_rules_condition_is_an_object/,
    )
  })

  it('refuses a blank name, and a name longer than the column holds', async () => {
    await clear()

    await expect(addRule({ name: '   ' })).rejects.toThrow(/alert_rules_name_is_not_blank/)
    await expect(addRule({ name: 'x'.repeat(121) })).rejects.toThrow(/alert_rules_name_is_bounded/)
  })

  it('refuses two live rules with the same name in one environment', async () => {
    await clear()
    await addRule({ name: 'too many errors' })

    await expect(addRule({ name: 'too many errors' })).rejects.toThrow(
      /alert_rules_one_name_per_environment/,
    )
  })

  it('lets a disabled rule keep a name a new one reuses', async () => {
    await clear()
    const first = await addRule({ name: 'too many errors' })
    await sql`update alert_rules set disabled_at = now() where id = ${first}`

    await expect(addRule({ name: 'too many errors' })).resolves.toMatch(/^alr_/)
  })

  it('refuses a rule whose environment belongs to another project', async () => {
    await clear()
    const other = id('prj_')
    const [project] = await sql`select organization_id from projects where id = ${projectId}`
    await sql`insert into projects ${sql({
      id: other,
      organization_id: project?.organization_id as string,
      name: 'other',
    })}`

    await expect(addRule({ project_id: other, environment_id: production })).rejects.toThrow(
      /alert_rules_environment_belongs_to_the_project/,
    )
  })

  it('refuses a firing rule that never says when it started firing', async () => {
    await clear()
    const ruleId = await addRule()

    await expect(sql`update alert_rules set state = 'firing' where id = ${ruleId}`).rejects.toThrow(
      /alert_rules_firing_means_there_is_a_moment/,
    )
  })
})

describe.skipIf(!reachable)('the SQL alert rule store against a real Postgres', () => {
  it('reads a live rule back with its condition parsed', async () => {
    await clear()
    const ruleId = await addRule()
    const store = sqlAlertRuleStore(run)

    const [found] = await store.live(50)

    expect(found).toMatchObject({
      id: ruleId,
      projectId,
      environmentId: production,
      state: 'ok',
      stateChangedAt: null,
    })
    expect(found?.condition).toEqual({
      type: 'threshold',
      query: 'level:error',
      window: '5m',
      operator: '>',
      value: 50,
      cooldown: '30m',
      channels: [CHANNEL],
    })
  })

  it('never reads a disabled rule', async () => {
    await clear()
    const ruleId = await addRule()
    await sql`update alert_rules set disabled_at = now() where id = ${ruleId}`
    const store = sqlAlertRuleStore(run)

    expect(await store.live(50)).toEqual([])
  })

  it('refuses a stored condition that no longer parses, rather than evaluating a guess', async () => {
    await clear()
    const ruleId = await addRule()
    await sql`update alert_rules set condition = ${sql.json({
      type: 'threshold',
      window: 'forever',
      channels: [CHANNEL],
    })} where id = ${ruleId}`
    const store = sqlAlertRuleStore(run)

    await expect(store.live(50)).rejects.toThrow(/window/)
  })

  it('applies a batch of transitions in one statement', async () => {
    await clear()
    const first = await addRule()
    const second = await addRule()
    const store = sqlAlertRuleStore(run)

    const moved = await store.applyTransitions([
      { ruleId: first, to: 'firing', measured: 99, at: NOW },
      { ruleId: second, to: 'firing', measured: 80, at: NOW },
    ])

    const rows =
      await sql`select id, state, state_changed_at from alert_rules where project_id = ${projectId} order by id`

    expect(moved).toBe(2)
    expect(rows.map((row) => row.state)).toEqual(['firing', 'firing'])
    expect(new Date(rows[0]?.state_changed_at as string).getTime()).toBe(NOW)
  })

  it('moves a rule back to ok and stamps when it changed', async () => {
    await clear()
    const ruleId = await addRule()
    const store = sqlAlertRuleStore(run)
    await store.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    await store.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW + MINUTE }])

    const [row] = await sql`select state, state_changed_at from alert_rules where id = ${ruleId}`
    expect(row?.state).toBe('ok')
    expect(new Date(row?.state_changed_at as string).getTime()).toBe(NOW + MINUTE)
  })

  it('changes nothing when the rule is already in that state', async () => {
    await clear()
    const ruleId = await addRule()
    const store = sqlAlertRuleStore(run)

    expect(await store.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW }])).toBe(0)
  })

  it('never moves a rule that was disabled since it was read', async () => {
    await clear()
    const ruleId = await addRule()
    await sql`update alert_rules set disabled_at = now() where id = ${ruleId}`
    const store = sqlAlertRuleStore(run)

    expect(await store.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])).toBe(0)
  })

  it('asks the database for nothing at all when there is nothing to do', async () => {
    const store = sqlAlertRuleStore(run)

    expect(await store.live(0)).toEqual([])
    expect(await store.applyTransitions([])).toBe(0)
  })
})

describe.skipIf(!reachable)('the alert channels table', () => {
  const KEY = 'a'.repeat(64)

  async function addChannel(overrides: Record<string, unknown> = {}): Promise<string> {
    const channelId = id('ch_')
    await sql`insert into alert_channels ${sql({
      id: channelId,
      project_id: projectId,
      name: channelId,
      kind: 'slack',
      target: 'https://hooks.slack.com/services/T000/B000/XXXX',
      ...overrides,
    })}`
    return channelId
  }

  async function clearChannels(): Promise<void> {
    await sql`delete from alert_channels where project_id = ${projectId}`
  }

  it('refuses an address that is not https for anything but e-mail', async () => {
    await clearChannels()

    await expect(addChannel({ target: 'http://hooks.slack.com/x' })).rejects.toThrow(
      /alert_channels_an_address_is_https_or_an_email/,
    )
    await expect(addChannel({ kind: 'discord', target: 'ops@example.com' })).rejects.toThrow(
      /alert_channels_an_address_is_https_or_an_email/,
    )
  })

  it('insists an e-mail address is lowercase, has an at and no space', async () => {
    await clearChannels()

    await expect(addChannel({ kind: 'email', target: 'OPS@example.com' })).rejects.toThrow(
      /alert_channels_an_address_is_https_or_an_email/,
    )
    await expect(addChannel({ kind: 'email', target: 'ops example.com' })).rejects.toThrow(
      /alert_channels_an_address_is_https_or_an_email/,
    )
    await expect(addChannel({ kind: 'email', target: 'ops@example.com' })).resolves.toMatch(/^ch_/)
  })

  it('refuses a webhook with no sealed secret, because nothing could sign it', async () => {
    await clearChannels()

    await expect(
      addChannel({ kind: 'webhook', target: 'https://ops.example.com/hook' }),
    ).rejects.toThrow(/alert_channels_a_webhook_carries_a_sealed_secret/)
  })

  it('refuses a secret that was not sealed, so a plaintext one cannot be stored', async () => {
    await clearChannels()

    for (const sealed of ['hunter2', 'v1.notHex.alsoNotHex', 'v1.aabb', 'AABB']) {
      await expect(
        addChannel({
          kind: 'webhook',
          target: 'https://ops.example.com/hook',
          sealed_secret: sealed,
        }),
      ).rejects.toThrow(/alert_channels_a_secret_is_never_stored_in_the_clear/)
    }
  })

  it('accepts a secret the sealer produced', async () => {
    await clearChannels()
    const channelId = id('ch_')
    const sealed = await sealSecret(newChannelSecret(), KEY, channelId)

    await sql`insert into alert_channels ${sql({
      id: channelId,
      project_id: projectId,
      name: channelId,
      kind: 'webhook',
      target: 'https://ops.example.com/hook',
      sealed_secret: sealed,
    })}`

    const [row] = await sql`select sealed_secret from alert_channels where id = ${channelId}`
    expect(row?.sealed_secret).toBe(sealed)
  })

  it('refuses a locale nobody writes the alert in', async () => {
    await clearChannels()

    await expect(addChannel({ locale: 'fr' })).rejects.toThrow(/alert_channels_locale_is_supported/)
  })

  it('refuses two live channels with the same name in one project', async () => {
    await clearChannels()
    await addChannel({ name: 'ops' })

    await expect(addChannel({ name: 'ops' })).rejects.toThrow(/alert_channels_one_name_per_project/)
  })

  it('reads back only the channels the rule named, and only live ones', async () => {
    await clearChannels()
    const wanted = await addChannel()
    const disabled = await addChannel({ disabled_at: new Date(NOW) })
    const unrelated = await addChannel()
    const store = sqlAlertChannelStore(run)

    const found = await store.byIds(projectId, [wanted, disabled])

    expect(found.map((one) => one.id)).toEqual([wanted])
    expect(found[0]).toMatchObject({ kind: 'slack', locale: 'en' })
    expect(found.map((one) => one.id)).not.toContain(unrelated)
  })

  it('reads back nothing for a project the channels do not belong to', async () => {
    await clearChannels()
    const channelId = await addChannel()
    const store = sqlAlertChannelStore(run)

    expect(await store.byIds('prj_somebody_else', [channelId])).toEqual([])
  })

  it('asks the database for nothing when the rule named no channel', async () => {
    const store = sqlAlertChannelStore(run)

    expect(await store.byIds(projectId, [])).toEqual([])
  })
})

describe.skipIf(!reachable)('the alerts waiting for a notice', () => {
  it('offers a rule whose state changed, with what it measured', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    const [waiting] = await sqlAlertNoticeStore(run).awaitingNotice(10)

    expect(waiting).toMatchObject({
      ruleId,
      state: 'firing',
      measured: 99,
      threshold: 50,
      window: '5m',
      environmentName: 'production',
      type: 'threshold',
    })
    expect(waiting?.changedAt).toBe(NOW)
  })

  it('offers it once, and again only when the state changes again', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)
    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    expect(await notices.awaitingNotice(10)).toHaveLength(1)
    await notices.markNotified(ruleId, NOW + MINUTE, NOW)
    expect(await notices.awaitingNotice(10)).toEqual([])

    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW + 2 * MINUTE }])
    expect(await notices.awaitingNotice(10)).toHaveLength(1)
  })

  it('never swallows a notice for a change that happened while it was sending', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    const [taken] = await notices.awaitingNotice(10)

    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW + MINUTE }])
    await notices.markNotified(ruleId, NOW + 2 * MINUTE, taken?.changedAt ?? 0)

    const [still] = await notices.awaitingNotice(10)
    expect(still?.state).toBe('ok')
    expect(still?.changedAt).toBe(NOW + MINUTE)
  })

  it('never offers a rule that never changed state', async () => {
    await clear()
    await addRule()

    expect(await sqlAlertNoticeStore(run).awaitingNotice(10)).toEqual([])
  })

  it('never offers a rule that was disabled since it fired', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    await sql`update alert_rules set disabled_at = now() where id = ${ruleId}`

    expect(await sqlAlertNoticeStore(run).awaitingNotice(10)).toEqual([])
  })

  it('names the channels the condition carries, so the notifier can find them', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    const [waiting] = await sqlAlertNoticeStore(run).awaitingNotice(10)

    expect(waiting?.channels).toEqual([CHANNEL])
  })

  it('asks the database for nothing at all when there is no room', async () => {
    expect(await sqlAlertNoticeStore(run).awaitingNotice(0)).toEqual([])
  })
})

describe.skipIf(!reachable)('the alert history', () => {
  async function eventsOf(ruleId: string): Promise<Array<Record<string, unknown>>> {
    return [...(await sql`select * from alert_events where rule_id = ${ruleId} order by at`)]
  }

  it('records one event for every state change, next to the transition', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 2, at: NOW + MINUTE }])

    const events = await eventsOf(ruleId)

    expect(events.map((row) => row.state)).toEqual(['firing', 'ok'])
    expect(events.map((row) => row.measured)).toEqual([99, 2])
    expect(events[0]?.threshold).toBe(50)
    expect(events[0]?.id).toMatch(/^ale_[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('records nothing for a transition the rule refused', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)

    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW }])

    expect(await eventsOf(ruleId)).toEqual([])
  })

  it('records at most one event per moment, so a replay cannot double the history', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    await sql`update alert_rules set state = 'ok' where id = ${ruleId}`
    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    expect(await eventsOf(ruleId)).toHaveLength(1)
  })

  it('writes what the notice did back onto the event', async () => {
    await clear()
    const ruleId = await addRule()
    const notices = sqlAlertNoticeStore(run)
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    await notices.recordOutcome(ruleId, NOW, {
      notifiedAt: NOW + 1000,
      channelsSent: 2,
      suppressed: null,
    })

    const [event] = await eventsOf(ruleId)
    expect(event).toMatchObject({ channels_sent: 2, suppressed: null })
    expect(event?.notified_at).not.toBeNull()
  })

  it('refuses an event that claims a notice reached nobody', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    await expect(
      sql`update alert_events set notified_at = now() where rule_id = ${ruleId}`,
    ).rejects.toThrow(/alert_events_a_notice_reached_a_channel/)
  })

  it('refuses a suppressed event that also says it was sent', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    await expect(
      sql`update alert_events set suppressed = 'cooldown', channels_sent = 1 where rule_id = ${ruleId}`,
    ).rejects.toThrow(/alert_events_a_suppressed_event_sent_nothing/)
  })

  it('offers the moment of the last firing notice, which is what the cooldown counts from', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    await notices.recordOutcome(ruleId, NOW, {
      notifiedAt: NOW,
      channelsSent: 1,
      suppressed: null,
    })
    await notices.markNotified(ruleId, NOW, NOW)
    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW + MINUTE }])

    const [waiting] = await notices.awaitingNotice(10)

    expect(waiting?.lastFiringNoticeAt).toBe(NOW)
    expect(waiting?.cooldownMinutes).toBe(30)
  })

  it('counts the last firing notice, not the last notice of any kind', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])
    await notices.recordOutcome(ruleId, NOW, { notifiedAt: NOW, channelsSent: 1, suppressed: null })
    await notices.markNotified(ruleId, NOW, NOW)

    await rules.applyTransitions([{ ruleId, to: 'ok', measured: 1, at: NOW + MINUTE }])
    await notices.recordOutcome(ruleId, NOW + MINUTE, {
      notifiedAt: NOW + MINUTE,
      channelsSent: 1,
      suppressed: null,
    })
    await notices.markNotified(ruleId, NOW + MINUTE, NOW + MINUTE)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW + 2 * MINUTE }])

    const [waiting] = await notices.awaitingNotice(10)

    expect(waiting?.lastFiringNoticeAt).toBe(NOW)
  })

  it('counts no firing notice until one actually went out', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    const [waiting] = await sqlAlertNoticeStore(run).awaitingNotice(10)

    expect(waiting?.lastFiringNoticeAt).toBeNull()
  })

  it('prunes only what is older than the window, oldest first', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)

    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 1, at: NOW - 200 * DAY }])
    await sql`update alert_rules set state = 'ok' where id = ${ruleId}`
    await rules.applyTransitions([{ ruleId, to: 'firing', measured: 2, at: NOW }])

    expect(await notices.prune(NOW - 90 * DAY, 100)).toBe(1)

    const left = await eventsOf(ruleId)
    expect(left).toHaveLength(1)
    expect(left[0]?.measured).toBe(2)
  })

  it('takes the oldest first when it cannot take them all in one run', async () => {
    await clear()
    const ruleId = await addRule()
    const rules = sqlAlertRuleStore(run)
    const notices = sqlAlertNoticeStore(run)

    for (const [at, measured] of [
      [NOW - 300 * DAY, 1],
      [NOW - 200 * DAY, 2],
      [NOW - 100 * DAY, 3],
    ] as const) {
      await sql`update alert_rules set state = 'ok' where id = ${ruleId}`
      await rules.applyTransitions([{ ruleId, to: 'firing', measured, at }])
    }

    expect(await notices.prune(NOW - 90 * DAY, 1)).toBe(1)

    const left = await eventsOf(ruleId)
    expect(left.map((row) => row.measured)).toEqual([2, 3])
  })

  it('asks the database for nothing when there is no room to prune', async () => {
    expect(await sqlAlertNoticeStore(run).prune(NOW, 0)).toBe(0)
  })

  it('goes away with the rule it belongs to', async () => {
    await clear()
    const ruleId = await addRule()
    await sqlAlertRuleStore(run).applyTransitions([{ ruleId, to: 'firing', measured: 99, at: NOW }])

    await sql`delete from alert_rules where id = ${ruleId}`

    expect(await eventsOf(ruleId)).toEqual([])
  })
})

describe.skipIf(!reachable)('the issue activity an alert rule reads', () => {
  async function addIssue(overrides: Record<string, unknown> = {}): Promise<string> {
    const issueId = id('iss_')
    const { environment_id: environmentId, ...rest } = overrides
    await sql`insert into issues ${sql({
      id: issueId,
      project_id: projectId,
      fingerprint: String(counter),
      title: 'boom',
      first_seen_at: new Date(NOW - MINUTE),
      last_seen_at: new Date(NOW - MINUTE),
      ...rest,
    })}`
    await sql`insert into issue_environments ${sql({
      issue_id: issueId,
      environment_id: (environmentId as string | undefined) ?? production,
      events: 1,
      first_seen_at: new Date(NOW - MINUTE),
      last_seen_at: new Date(NOW - MINUTE),
    })}`
    return issueId
  }

  it('counts the issues that opened inside the window, in that environment only', async () => {
    await sql`delete from issues where project_id = ${projectId}`
    await addIssue()
    await addIssue({ first_seen_at: new Date(NOW - 90 * MINUTE) })
    await addIssue({ environment_id: staging })

    const activity = await sqlIssueActivity(run)(production, { from: NOW - 5 * MINUTE, to: NOW })

    expect(activity.opened).toBe(1)
    expect(activity.regressed).toBe(0)
  })

  it('counts a regression separately from a new issue', async () => {
    await sql`delete from issues where project_id = ${projectId}`
    await addIssue({
      first_seen_at: new Date(NOW - 90 * MINUTE),
      resolved_at: new Date(NOW - 60 * MINUTE),
      regressed_at: new Date(NOW - MINUTE),
    })

    const activity = await sqlIssueActivity(run)(production, { from: NOW - 5 * MINUTE, to: NOW })

    expect(activity.opened).toBe(0)
    expect(activity.regressed).toBe(1)
  })

  it('counts nothing when the window closed before anything happened', async () => {
    await sql`delete from issues where project_id = ${projectId}`
    await addIssue()

    const activity = await sqlIssueActivity(run)(production, {
      from: NOW - 90 * MINUTE,
      to: NOW - 60 * MINUTE,
    })

    expect(activity).toEqual({ opened: 0, regressed: 0 })
  })
})
