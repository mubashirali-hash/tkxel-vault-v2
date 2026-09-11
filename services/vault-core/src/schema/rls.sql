-- tkxel Vault Defense-in-Depth Row-Level Security (RLS) Policies
-- Enforces per-vault multi-tenant data boundaries at the database layer

-- Enable RLS across all vault data tables
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE links ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE shares ENABLE ROW LEVEL SECURITY;

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

-- Policy: Vaults are accessible if user is owner or has a share
CREATE POLICY vaults_access_policy ON vaults
    FOR ALL
    USING (owner_id = current_setting('app.current_user_id', true) OR has_vault_access(id, 'consumer'));

-- Policy: Pages are accessible only if user has reader/editor/owner access
CREATE POLICY pages_access_policy ON pages
    FOR ALL
    USING (has_vault_access(vault_id, 'reader'));

-- Policy: Versions accessible only if user has reader/editor/owner access
CREATE POLICY versions_access_policy ON versions
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM pages p 
        WHERE p.id = versions.page_id 
          AND has_vault_access(p.vault_id, 'reader')
    ));

-- Policy: Chunks accessible under reader or consumer execution context
CREATE POLICY chunks_access_policy ON chunks
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM pages p 
        WHERE p.id = chunks.page_id 
          AND has_vault_access(p.vault_id, 'consumer')
    ));

-- Policy: Skills accessible under consumer or editor/owner access
CREATE POLICY skills_access_policy ON skills
    FOR ALL
    USING (has_vault_access(vault_id, 'consumer'));
