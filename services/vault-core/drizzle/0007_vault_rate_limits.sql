-- FR-67: per-vault rate limits set by the vault Owner. NULL means the platform default applies.
ALTER TABLE "vaults" ADD COLUMN IF NOT EXISTS "rate_limits" jsonb;
