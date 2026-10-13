-- tkxel Vault Database Initialization Script
-- Enables required PostgreSQL extensions for UUIDs and Vector Embeddings

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Verification table to confirm extensions are active
DO $$
BEGIN
    RAISE NOTICE 'tkxel Vault extensions initialized: uuid-ossp and pgvector active.';
END $$;
