import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
} as const

export const ULID_CHARS = 26

export const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}'

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export const API_KEY_KINDS = ['public', 'secret'] as const
export const API_KEY_SCOPES = ['logs:write', 'logs:read'] as const

export const membershipRole = pgEnum('membership_role', MEMBERSHIP_ROLES)
export const apiKeyKind = pgEnum('api_key_kind', API_KEY_KINDS)

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
