-- tkxel Vault Defense-in-Depth Row-Level Security (RLS) Policies
-- Enforces per-vault multi-tenant data boundaries at the database layer

-- Enable and FORCE RLS across all vault data tables (FORCE applies RLS to table owners)
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaults FORCE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages FORCE ROW LEVEL SECURITY;
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE links FORCE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE ROW LEVEL SECURITY;
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares FORCE ROW LEVEL SECURITY;

-- Ensure non-superuser application role exists (superusers bypass RLS in Postgres)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vault_app') THEN
        CREATE ROLE vault_app LOGIN PASSWORD 'vaultpassword';
    END IF;
END $$;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vault_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO vault_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO vault_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO vault_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO vault_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO vault_app;

-- Helper function to check if current user has access to a vault
CREATE OR REPLACE FUNCTION has_vault_access(v_id UUID, required_role TEXT DEFAULT 'reader')
RETURNS BOOLEAN AS $$
DECLARE
    user_id TEXT := current_setting('app.current_user_id', true);
BEGIN
    IF user_id IS NULL OR user_id = '' THEN
        RETURN FALSE;
    END IF;

    -- Owner check
    IF EXISTS (SELECT 1 FROM vaults WHERE id = v_id AND owner_id = user_id) THEN
        RETURN TRUE;
    END IF;

    -- Share check (with unrevoked role)
    IF required_role = 'consumer' THEN
        RETURN EXISTS (
            SELECT 1 FROM shares 
            WHERE vault_id = v_id 
              AND principal_id = user_id 
              AND role IN ('consumer', 'reader', 'editor')
              AND revoked_at IS NULL
        );
    ELSIF required_role = 'reader' THEN
        RETURN EXISTS (
            SELECT 1 FROM shares 
            WHERE vault_id = v_id 
              AND principal_id = user_id 
              AND role IN ('reader', 'editor')
              AND revoked_at IS NULL
        );
    ELSIF required_role = 'editor' THEN
        RETURN EXISTS (
            SELECT 1 FROM shares 
            WHERE vault_id = v_id 
              AND principal_id = user_id 
              AND role = 'editor'
              AND revoked_at IS NULL
        );
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing policies if they exist for idempotency
DROP POLICY IF EXISTS vaults_select ON vaults;
DROP POLICY IF EXISTS vaults_insert ON vaults;
DROP POLICY IF EXISTS vaults_update ON vaults;
DROP POLICY IF EXISTS vaults_delete ON vaults;
DROP POLICY IF EXISTS vaults_access_policy ON vaults;

DROP POLICY IF EXISTS pages_select ON pages;
DROP POLICY IF EXISTS pages_insert ON pages;
DROP POLICY IF EXISTS pages_update ON pages;
DROP POLICY IF EXISTS pages_delete ON pages;
DROP POLICY IF EXISTS pages_access_policy ON pages;

DROP POLICY IF EXISTS versions_select ON versions;
DROP POLICY IF EXISTS versions_insert ON versions;
DROP POLICY IF EXISTS versions_update ON versions;
DROP POLICY IF EXISTS versions_delete ON versions;
DROP POLICY IF EXISTS versions_access_policy ON versions;

DROP POLICY IF EXISTS chunks_select ON chunks;
DROP POLICY IF EXISTS chunks_insert ON chunks;
DROP POLICY IF EXISTS chunks_update ON chunks;
DROP POLICY IF EXISTS chunks_delete ON chunks;
DROP POLICY IF EXISTS chunks_access_policy ON chunks;

DROP POLICY IF EXISTS skills_select ON skills;
DROP POLICY IF EXISTS skills_insert ON skills;
DROP POLICY IF EXISTS skills_update ON skills;
DROP POLICY IF EXISTS skills_delete ON skills;
DROP POLICY IF EXISTS skills_access_policy ON skills;

DROP POLICY IF EXISTS links_select ON links;
DROP POLICY IF EXISTS links_insert ON links;
DROP POLICY IF EXISTS links_update ON links;
DROP POLICY IF EXISTS links_delete ON links;
DROP POLICY IF EXISTS links_access_policy ON links;

DROP POLICY IF EXISTS shares_select ON shares;
DROP POLICY IF EXISTS shares_insert ON shares;
DROP POLICY IF EXISTS shares_update ON shares;
DROP POLICY IF EXISTS shares_delete ON shares;
DROP POLICY IF EXISTS shares_access_policy ON shares;

-- Vaults
CREATE POLICY vaults_select ON vaults FOR SELECT USING (owner_id = current_setting('app.current_user_id', true) OR has_vault_access(id, 'consumer'));
CREATE POLICY vaults_insert ON vaults FOR INSERT WITH CHECK (owner_id = current_setting('app.current_user_id', true));
CREATE POLICY vaults_update ON vaults FOR UPDATE USING (owner_id = current_setting('app.current_user_id', true));
CREATE POLICY vaults_delete ON vaults FOR DELETE USING (owner_id = current_setting('app.current_user_id', true));

-- Pages
CREATE POLICY pages_select ON pages FOR SELECT USING (has_vault_access(vault_id, 'reader'));
CREATE POLICY pages_insert ON pages FOR INSERT WITH CHECK (has_vault_access(vault_id, 'editor'));
CREATE POLICY pages_update ON pages FOR UPDATE USING (has_vault_access(vault_id, 'editor'));
CREATE POLICY pages_delete ON pages FOR DELETE USING (has_vault_access(vault_id, 'editor'));

-- Versions
CREATE POLICY versions_select ON versions FOR SELECT USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = versions.page_id AND has_vault_access(p.vault_id, 'reader')));
CREATE POLICY versions_insert ON versions FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM pages p WHERE p.id = versions.page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY versions_update ON versions FOR UPDATE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = versions.page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY versions_delete ON versions FOR DELETE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = versions.page_id AND has_vault_access(p.vault_id, 'editor')));

-- Chunks
CREATE POLICY chunks_select ON chunks FOR SELECT USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = chunks.page_id AND has_vault_access(p.vault_id, 'consumer')));
CREATE POLICY chunks_insert ON chunks FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM pages p WHERE p.id = chunks.page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY chunks_update ON chunks FOR UPDATE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = chunks.page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY chunks_delete ON chunks FOR DELETE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = chunks.page_id AND has_vault_access(p.vault_id, 'editor')));

-- Skills
CREATE POLICY skills_select ON skills FOR SELECT USING (has_vault_access(vault_id, 'consumer'));
CREATE POLICY skills_insert ON skills FOR INSERT WITH CHECK (has_vault_access(vault_id, 'editor'));
CREATE POLICY skills_update ON skills FOR UPDATE USING (has_vault_access(vault_id, 'editor'));
CREATE POLICY skills_delete ON skills FOR DELETE USING (has_vault_access(vault_id, 'editor'));

-- Links
CREATE POLICY links_select ON links FOR SELECT USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = links.from_page_id AND has_vault_access(p.vault_id, 'reader')));
CREATE POLICY links_insert ON links FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM pages p WHERE p.id = links.from_page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY links_update ON links FOR UPDATE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = links.from_page_id AND has_vault_access(p.vault_id, 'editor')));
CREATE POLICY links_delete ON links FOR DELETE USING (EXISTS (SELECT 1 FROM pages p WHERE p.id = links.from_page_id AND has_vault_access(p.vault_id, 'editor')));

-- Shares
CREATE POLICY shares_select ON shares FOR SELECT USING (
    EXISTS (SELECT 1 FROM vaults v WHERE v.id = shares.vault_id AND v.owner_id = current_setting('app.current_user_id', true))
    OR principal_id = current_setting('app.current_user_id', true)
);
CREATE POLICY shares_insert ON shares FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM vaults v WHERE v.id = shares.vault_id AND v.owner_id = current_setting('app.current_user_id', true)));
CREATE POLICY shares_update ON shares FOR UPDATE USING (EXISTS (SELECT 1 FROM vaults v WHERE v.id = shares.vault_id AND v.owner_id = current_setting('app.current_user_id', true)));
CREATE POLICY shares_delete ON shares FOR DELETE USING (EXISTS (SELECT 1 FROM vaults v WHERE v.id = shares.vault_id AND v.owner_id = current_setting('app.current_user_id', true)));
