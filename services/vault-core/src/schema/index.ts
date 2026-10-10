import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  integer,
  boolean,
  timestamp,
  customType,
  index,
  check,
  primaryKey
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom pgvector type for vector(1536)
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  }
});

// Custom PostgreSQL tsvector type for full-text search
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  }
});

// Custom bytea type for encrypted blobs
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  }
});

// 1. Vaults Table
export const vaults = pgTable('vaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  mode: varchar('mode', { length: 32 }).notNull().$type<'open' | 'locked'>(),
  owner_id: varchar('owner_id', { length: 255 }).notNull(),
  data_key_id: varchar('data_key_id', { length: 255 }).notNull(),
  export_policy: varchar('export_policy', { length: 32 })
    .notNull()
    .$type<'allowed_for_owner' | 'strictly_forbidden'>(),
    // Owner-configured per-user hourly limits (FR-67); null = platform defaults
    rate_limits: jsonb('rate_limits'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// 2. Pages Table
export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vault_id: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 })
      .notNull()
      .$type<'note' | 'person' | 'client' | 'project' | 'decision' | 'meeting' | 'skill' | 'other'>(),
    title: varchar('title', { length: 255 }).notNull(),
    aliases: text('aliases')
      .array()
      .default([])
      .notNull(),
    tags: text('tags')
      .array()
      .default([])
      .notNull(),
    front_matter: jsonb('front_matter').default({}).notNull(),
    current_version_id: uuid('current_version_id'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_pages_vault').on(table.vault_id),
    index('idx_pages_title').on(table.title)
  ]
);
// 3. Versions Table
export const versions = pgTable(
  'versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    page_id: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    status: varchar('status', { length: 32 })
      .notNull()
      .$type<'draft' | 'published' | 'unpublished'>(),
    encrypted_blob: bytea('encrypted_blob').notNull(),
    created_by: varchar('created_by', { length: 255 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_versions_page_number').on(table.page_id, table.number)
  ]
);

// 4. Links Table
export const links = pgTable(
  'links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    from_page_id: uuid('from_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    to_page_id: uuid('to_page_id').references(() => pages.id, { onDelete: 'set null' }),
    raw_target: varchar('raw_target', { length: 255 }).notNull(),
    link_type: varchar('link_type', { length: 64 }),
    resolved: boolean('resolved').default(false).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_links_from').on(table.from_page_id),
    index('idx_links_to').on(table.to_page_id),
    index('idx_links_target').on(table.raw_target),
    check('links_resolved_has_target', sql`${table.resolved} = (${table.to_page_id} IS NOT NULL)`)
  ]
);

// 5. Timeline Entries Table
export const timelineEntries = pgTable(
  'timeline_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    page_id: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    date: varchar('date', { length: 32 }).notNull(),
    entry_text: text('entry_text').notNull(),
    created_by: varchar('created_by', { length: 255 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_timeline_page').on(table.page_id)
  ]
);

// 6. Chunks Table
export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    page_id: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    version_id: uuid('version_id')
      .notNull()
      .references(() => versions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    encrypted_text: bytea('encrypted_text').notNull(),
    tsv_content: tsvector('tsv_content'),
    embedding: vector('embedding')
  },
  (table) => [
    index('idx_chunks_page').on(table.page_id),
    index('idx_chunks_version').on(table.version_id)
  ]
);

// 7. Skills Table
export const skills = pgTable(
  'skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vault_id: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    tool_schema: jsonb('tool_schema').notNull(),
    current_version_id: uuid('current_version_id'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_skills_vault').on(table.vault_id)
  ]
);

// 8. Shares Table
export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vault_id: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    principal_id: varchar('principal_id', { length: 255 }).notNull(),
    role: varchar('role', { length: 32 })
      .notNull()
      .$type<'owner' | 'editor' | 'reader' | 'consumer'>(),
    granted_by: varchar('granted_by', { length: 255 }).notNull(),
    granted_at: timestamp('granted_at', { withTimezone: true }).defaultNow().notNull(),
    revoked_at: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    index('idx_shares_vault').on(table.vault_id),
    index('idx_shares_principal').on(table.principal_id)
  ]
);

// 8b. User Groups (SSO group membership observed at sign-in; resolves group shares, FR-52)
export const userGroups = pgTable(
  'user_groups',
  {
    user_id: varchar('user_id', { length: 255 }).notNull(),
    group_id: varchar('group_id', { length: 255 }).notNull(),
    seen_at: timestamp('seen_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ name: 'user_groups_pk', columns: [table.user_id, table.group_id] }),
    index('idx_user_groups_user').on(table.user_id)
  ]
);

// 8c. Assets (vault-hosted images, FR-02): ciphertext only
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vault_id: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    file_name: varchar('file_name', { length: 255 }).notNull(),
    mime_type: varchar('mime_type', { length: 64 }).notNull(),
    size_bytes: integer('size_bytes').notNull(),
    encrypted_blob: bytea('encrypted_blob').notNull(),
    created_by: varchar('created_by', { length: 255 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('idx_assets_vault').on(table.vault_id)
  ]
);

// 8d. Break-glass requests (NFR-06): dual-authorized, time-limited administrator access to a locked vault
export const breakGlassRequests = pgTable(
  'break_glass_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vault_id: uuid('vault_id')
      .notNull()
      .references(() => vaults.id, { onDelete: 'cascade' }),
    requester_id: varchar('requester_id', { length: 255 }).notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    approver_id: varchar('approver_id', { length: 255 }),
    requested_at: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
    decided_at: timestamp('decided_at', { withTimezone: true }),
    expires_at: timestamp('expires_at', { withTimezone: true })
  },
  (table) => [
    index('idx_break_glass_vault').on(table.vault_id),
    index('idx_break_glass_requester').on(table.requester_id)
  ]
);

// 9. Audit Events Table (Append-Only)
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor_id: varchar('actor_id', { length: 255 }).notNull(),
    action: varchar('action', { length: 64 }).notNull(),
    target_id: varchar('target_id', { length: 255 }).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata').default({}).notNull()
  },
  (table) => [
    index('idx_audit_actor').on(table.actor_id),
    index('idx_audit_action').on(table.action),
    index('idx_audit_timestamp').on(table.timestamp)
  ]
);

