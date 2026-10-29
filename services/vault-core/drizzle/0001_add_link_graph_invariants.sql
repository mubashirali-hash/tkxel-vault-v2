CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "links" DROP CONSTRAINT IF EXISTS "links_resolved_has_target";
  ALTER TABLE "links" ADD CONSTRAINT "links_resolved_has_target" CHECK (resolved = (to_page_id IS NOT NULL));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trg_links_before_update_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- When target page is deleted via ON DELETE SET NULL, automatically convert link to ghost link
  IF NEW.to_page_id IS NULL AND (OLD.to_page_id IS NOT NULL OR OLD.resolved = true) THEN
    NEW.resolved := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_links_before_update ON links;
--> statement-breakpoint
CREATE TRIGGER trg_links_before_update
BEFORE UPDATE ON links
FOR EACH ROW
EXECUTE FUNCTION trg_links_before_update_fn();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_link_invariants()
RETURNS TRIGGER AS $$
DECLARE
  from_vault_id UUID;
  from_vault_mode TEXT;
  to_vault_id UUID;
BEGIN
  -- If link was deleted before commit, do nothing
  IF NOT EXISTS (SELECT 1 FROM links WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;

  -- Re-read latest link state from table in case subsequent statements in tx modified it
  SELECT resolved, to_page_id, from_page_id INTO NEW.resolved, NEW.to_page_id, NEW.from_page_id
  FROM links WHERE id = NEW.id;

  -- 1. Exact ghost link state invariant (defense-in-depth alongside CHECK constraint)
  IF NEW.resolved = true AND NEW.to_page_id IS NULL THEN
    RAISE EXCEPTION 'Link invariant violation: resolved link must have non-null to_page_id (link id: %)', NEW.id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolved = false AND NEW.to_page_id IS NOT NULL THEN
    RAISE EXCEPTION 'Link invariant violation: unresolved ghost link must have null to_page_id (link id: %)', NEW.id
      USING ERRCODE = '23514';
  END IF;

  -- 2. Query source page's vault and mode
  SELECT p.vault_id, v.mode INTO from_vault_id, from_vault_mode
  FROM pages p
  JOIN vaults v ON p.vault_id = v.id
  WHERE p.id = NEW.from_page_id;

  -- Locked vaults cannot have outgoing links
  IF from_vault_mode = 'locked' THEN
    RAISE EXCEPTION 'Link invariant violation: links originating from locked vaults are forbidden (link id: %, vault: %)', NEW.id, from_vault_id
      USING ERRCODE = '23514';
  END IF;

  -- 3. Intra-vault rule for resolved links
  IF NEW.resolved = true THEN
    SELECT p.vault_id INTO to_vault_id
    FROM pages p
    WHERE p.id = NEW.to_page_id;

    IF to_vault_id IS NULL OR from_vault_id != to_vault_id THEN
      RAISE EXCEPTION 'Link invariant violation: resolved link endpoints belong to different vaults (from_vault: %, to_vault: %, link id: %)', from_vault_id, to_vault_id, NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_links_enforce_invariants ON links;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_links_enforce_invariants
AFTER INSERT OR UPDATE ON links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_link_invariants();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_page_link_invariants()
RETURNS TRIGGER AS $$
DECLARE
  new_vault_mode TEXT;
  curr_vault_id UUID;
BEGIN
  -- If page was deleted before commit, do nothing
  IF NOT EXISTS (SELECT 1 FROM pages WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;

  SELECT vault_id INTO curr_vault_id FROM pages WHERE id = NEW.id;

  SELECT v.mode INTO new_vault_mode
  FROM vaults v
  WHERE v.id = curr_vault_id;

  -- If new vault is locked, no links may originate from this page
  IF new_vault_mode = 'locked' THEN
    IF EXISTS (SELECT 1 FROM links WHERE from_page_id = NEW.id) THEN
      RAISE EXCEPTION 'Page link invariant violation: page in locked vault cannot have outgoing links (page id: %, vault id: %)', NEW.id, curr_vault_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- No outgoing resolved links may connect to a page in a different vault
  IF EXISTS (
    SELECT 1 FROM links l
    JOIN pages p_to ON l.to_page_id = p_to.id
    WHERE l.from_page_id = NEW.id
      AND l.resolved = true
      AND p_to.vault_id != curr_vault_id
  ) THEN
    RAISE EXCEPTION 'Page link invariant violation: page outgoing resolved link connects to a different vault (page id: %, vault id: %)', NEW.id, curr_vault_id
      USING ERRCODE = '23514';
  END IF;

  -- No incoming resolved links may originate from a page in a different vault
  IF EXISTS (
    SELECT 1 FROM links l
    JOIN pages p_from ON l.from_page_id = p_from.id
    WHERE l.to_page_id = NEW.id
      AND l.resolved = true
      AND p_from.vault_id != curr_vault_id
  ) THEN
    RAISE EXCEPTION 'Page link invariant violation: page incoming resolved link originates from a different vault (page id: %, vault id: %)', NEW.id, curr_vault_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_pages_enforce_link_invariants ON pages;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_pages_enforce_link_invariants
AFTER UPDATE OF vault_id ON pages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_page_link_invariants();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_vault_link_invariants()
RETURNS TRIGGER AS $$
DECLARE
  curr_mode TEXT;
BEGIN
  -- If vault was deleted before commit, do nothing
  IF NOT EXISTS (SELECT 1 FROM vaults WHERE id = NEW.id) THEN
    RETURN NULL;
  END IF;

  SELECT mode INTO curr_mode FROM vaults WHERE id = NEW.id;

  -- If vault mode changed to locked, no links may originate from pages in this vault
  IF curr_mode = 'locked' THEN
    IF EXISTS (
      SELECT 1 FROM links l
      JOIN pages p ON l.from_page_id = p.id
      WHERE p.vault_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Vault mode invariant violation: locked vault cannot have outgoing links (vault id: %)', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_vaults_enforce_link_invariants ON vaults;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER trg_vaults_enforce_link_invariants
AFTER UPDATE OF mode ON vaults
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION check_vault_link_invariants();
