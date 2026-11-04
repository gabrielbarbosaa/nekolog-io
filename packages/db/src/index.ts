import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const ID_PREFIXES = {
  user: 'usr_',
  organization: 'org_',
  membership: 'mem_',
  invite: 'inv_',
  project: 'prj_',
  environment: 'env_',
  apiKey: 'key_',
  auditEntry: 'aud_',
  emailSuppression: 'sup_',
  savedView: 'viw_',
  dashboard: 'dsh_',
  release: 'rel_',
  export: 'exp_',
  exportSchedule: 'exs_',
} as const

export const ULID_CHARS = 26

export const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}'

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export const API_KEY_KINDS = ['public', 'secret'] as const
export const API_KEY_SCOPES = ['logs:write', 'logs:read'] as const
export const SUPPRESSION_REASONS = ['bounce', 'complaint', 'manual'] as const
export const EXPORT_FORMATS = ['json', 'xml', 'csv'] as const
export const EXPORT_STATUSES = ['pending', 'running', 'ready', 'failed', 'expired'] as const
export const EXPORT_CADENCES = ['daily', 'weekly'] as const

export const MAX_SEARCH_QUERY_CHARS = 2000
export const MAX_DASHBOARD_WIDGETS = 50
export const MAX_RELEASE_VERSION_CHARS = 200

export const suppressionReason = pgEnum('suppression_reason', SUPPRESSION_REASONS)
export const membershipRole = pgEnum('membership_role', MEMBERSHIP_ROLES)
export const apiKeyKind = pgEnum('api_key_kind', API_KEY_KINDS)
export const exportFormat = pgEnum('export_format', EXPORT_FORMATS)
export const exportStatus = pgEnum('export_status', EXPORT_STATUSES)
export const exportCadence = pgEnum('export_cadence', EXPORT_CADENCES)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('UTC'),
    isOperator: boolean('is_operator').notNull().default(false),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_key').on(table.email),
    check('users_id_shape', sql`id ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('users_email_is_lowercase', sql`email = lower(email)`),
    check('users_email_has_an_at', sql`email like '%@%'`),
    check('users_locale_is_supported', sql`locale in ('en', 'pt-BR', 'es')`),
  ],
)

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('organizations_id_shape', sql`id ~ '^org_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('organizations_name_is_not_blank', sql`length(btrim(name)) > 0`),
  ],
)

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memberships_one_per_user_and_organization').on(table.organizationId, table.userId),
    index('memberships_by_user').on(table.userId),
    check('memberships_id_shape', sql`id ~ '^mem_[0-9A-HJKMNP-TV-Z]{26}$'`),
  ],
)

export const invites = pgTable(
  'invites',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: membershipRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invites_token_hash_key').on(table.tokenHash),
    uniqueIndex('invites_one_open_per_email_and_organization')
      .on(table.organizationId, table.email)
      .where(sql`accepted_at is null and revoked_at is null`),
    check('invites_id_shape', sql`id ~ '^inv_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('invites_email_is_lowercase', sql`email = lower(email)`),
    check('invites_role_is_not_owner', sql`role <> 'owner'`),
    check('invites_expire_after_they_are_created', sql`expires_at > created_at`),
  ],
)

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('projects_by_organization').on(table.organizationId),
    check('projects_id_shape', sql`id ~ '^prj_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('projects_name_is_not_blank', sql`length(btrim(name)) > 0`),
  ],
)

export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    retentionDays: integer('retention_days').notNull().default(7),
    dailyEventQuota: integer('daily_event_quota'),
    originAllowlist: text('origin_allowlist').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('environments_one_name_per_project').on(table.projectId, table.name),
    uniqueIndex('environments_id_and_project').on(table.id, table.projectId),
    check('environments_id_shape', sql`id ~ '^env_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('environments_name_shape', sql`name ~ '^[a-z][a-z0-9-]{0,30}$'`),
    check('environments_retention_is_at_least_a_day', sql`retention_days >= 1`),
    check(
      'environments_quota_is_positive_when_set',
      sql`daily_event_quota is null or daily_event_quota > 0`,
    ),
  ],
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    kind: apiKeyKind('kind').notNull(),
    hash: text('hash').notNull(),
    hint: text('hint').notNull(),
    scopes: text('scopes').array().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_keys_hash_key').on(table.hash),
    index('api_keys_by_environment').on(table.environmentId),
    check('api_keys_id_shape', sql`id ~ '^key_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('api_keys_hash_is_sha256_hex', sql`hash ~ '^[0-9a-f]{64}$'`),
    check(
      'api_keys_scopes_are_known',
      sql`scopes <@ array['logs:write', 'logs:read']::text[] and array_length(scopes, 1) >= 1`,
    ),
    check(
      'api_keys_public_only_writes',
      sql`kind <> 'public' or scopes = array['logs:write']::text[]`,
    ),
  ],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonb('metadata'),
    country: text('country'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_by_organization_and_time').on(table.organizationId, table.createdAt),
    check('audit_log_id_shape', sql`id ~ '^aud_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('audit_log_country_is_a_code', sql`country is null or country ~ '^[A-Z]{2}$'`),
  ],
)

export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    id: text('id').primaryKey(),
    address: text('address').notNull(),
    reason: suppressionReason('reason').notNull(),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('email_suppressions_address').on(table.address),
    check('email_suppressions_id_shape', sql`id ~ '^sup_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('email_suppressions_address_is_lowercase', sql`address = lower(address)`),
    check(
      'email_suppressions_address_has_one_at',
      sql`address ~ '^[^@[:space:]]+@[^@[:space:]]+$'`,
    ),
  ],
)

export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id'),
    name: text('name').notNull(),
    query: text('query').notNull().default(''),
    timeRange: text('time_range'),
    shared: boolean('shared').notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.environmentId, table.projectId],
      foreignColumns: [environments.id, environments.projectId],
      name: 'saved_views_environment_belongs_to_the_project',
    }).onDelete('cascade'),
    index('saved_views_by_project').on(table.projectId),
    uniqueIndex('saved_views_one_shared_name_per_project')
      .on(table.projectId, table.name)
      .where(sql`shared`),
    check('saved_views_id_shape', sql`id ~ '^viw_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('saved_views_name_is_not_blank', sql`length(btrim(name)) > 0`),
    check('saved_views_query_is_bounded', sql`length(query) <= 2000`),
    check(
      'saved_views_time_range_shape',
      sql`time_range is null or time_range ~ '^[0-9]{1,4}[mhd]$'`,
    ),
  ],
)

export const dashboards = pgTable(
  'dashboards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    widgets: jsonb('widgets').notNull().default(sql`'[]'::jsonb`),
    shared: boolean('shared').notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('dashboards_by_project').on(table.projectId),
    uniqueIndex('dashboards_one_shared_name_per_project')
      .on(table.projectId, table.name)
      .where(sql`shared`),
    check('dashboards_id_shape', sql`id ~ '^dsh_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('dashboards_name_is_not_blank', sql`length(btrim(name)) > 0`),
    check('dashboards_widgets_are_a_list', sql`jsonb_typeof(widgets) = 'array'`),
    check(
      'dashboards_widget_count_is_bounded',
      sql`jsonb_typeof(widgets) <> 'array' or jsonb_array_length(widgets) <= 50`,
    ),
  ],
)

export const releases = pgTable(
  'releases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id').notNull(),
    version: text('version').notNull(),
    commit: text('commit'),
    sourcemapCount: integer('sourcemap_count').notNull().default(0),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.environmentId, table.projectId],
      foreignColumns: [environments.id, environments.projectId],
      name: 'releases_environment_belongs_to_the_project',
    }).onDelete('cascade'),
    uniqueIndex('releases_one_version_per_environment').on(table.environmentId, table.version),
    index('releases_by_project_and_time').on(table.projectId, table.releasedAt),
    check('releases_id_shape', sql`id ~ '^rel_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check(
      'releases_version_shape',
      sql`version = btrim(version) and length(version) between 1 and 200`,
    ),
    check(
      'releases_commit_is_hex_when_set',
      sql`"commit" is null or "commit" ~ '^[0-9a-f]{7,40}$'`,
    ),
    check('releases_sourcemap_count_is_not_negative', sql`sourcemap_count >= 0`),
  ],
)

export const exportSchedules = pgTable(
  'export_schedules',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id').notNull(),
    cadence: exportCadence('cadence').notNull(),
    format: exportFormat('format').notNull(),
    query: text('query').notNull().default(''),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.environmentId, table.projectId],
      foreignColumns: [environments.id, environments.projectId],
      name: 'export_schedules_environment_belongs_to_the_project',
    }).onDelete('cascade'),
    uniqueIndex('export_schedules_one_live_cadence_per_environment')
      .on(table.environmentId, table.cadence)
      .where(sql`disabled_at is null`),
    check('export_schedules_id_shape', sql`id ~ '^exs_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('export_schedules_query_is_bounded', sql`length(query) <= 2000`),
  ],
)

export const exports = pgTable(
  'exports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    environmentId: text('environment_id').notNull(),
    scheduleId: text('schedule_id').references(() => exportSchedules.id, { onDelete: 'set null' }),
    requestedBy: text('requested_by').references(() => users.id, { onDelete: 'set null' }),
    format: exportFormat('format').notNull(),
    status: exportStatus('status').notNull().default('pending'),
    query: text('query').notNull().default(''),
    rangeFrom: timestamp('range_from', { withTimezone: true }).notNull(),
    rangeTo: timestamp('range_to', { withTimezone: true }).notNull(),
    objectKey: text('object_key'),
    byteSize: bigint('byte_size', { mode: 'number' }),
    rowCount: bigint('row_count', { mode: 'number' }),
    failure: text('failure'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.environmentId, table.projectId],
      foreignColumns: [environments.id, environments.projectId],
      name: 'exports_environment_belongs_to_the_project',
    }).onDelete('cascade'),
    index('exports_by_environment_and_time').on(table.environmentId, table.createdAt),
    index('exports_waiting_to_expire').on(table.expiresAt).where(sql`status = 'ready'`),
    check('exports_id_shape', sql`id ~ '^exp_[0-9A-HJKMNP-TV-Z]{26}$'`),
    check('exports_query_is_bounded', sql`length(query) <= 2000`),
    check('exports_range_moves_forward', sql`range_to > range_from`),
    check('exports_expire_after_they_are_asked_for', sql`expires_at > created_at`),
    check(
      'exports_ready_means_there_is_an_object',
      sql`status <> 'ready' or object_key is not null`,
    ),
    check('exports_failed_means_there_is_a_reason', sql`status <> 'failed' or failure is not null`),
    check('exports_size_is_not_negative', sql`byte_size is null or byte_size >= 0`),
    check('exports_row_count_is_not_negative', sql`row_count is null or row_count >= 0`),
    check(
      'exports_object_key_stays_inside_the_prefix',
      sql`object_key is null or object_key ~ '^exports/[A-Za-z0-9._/-]+$'`,
    ),
    check(
      'exports_object_key_has_no_dot_dot',
      sql`object_key is null or object_key not like '%..%'`,
    ),
  ],
)
