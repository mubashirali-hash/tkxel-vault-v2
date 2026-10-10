-- NFR-05: re-keying a vault must re-encrypt its timeline entries, which are otherwise append-only (FR-06).
-- The update is permitted only inside a transaction that sets app.timeline_rekey, only when nothing but
-- the ciphertext changes, and only from one ciphertext to another.
CREATE OR REPLACE FUNCTION block_timeline_update()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.timeline_rekey', true) = 'on'
       AND NEW.id = OLD.id
       AND NEW.page_id = OLD.page_id
       AND NEW.date = OLD.date
       AND NEW.created_by = OLD.created_by
       AND NEW.created_at = OLD.created_at
       AND OLD.entry_text LIKE 'enc:v1:%'
       AND NEW.entry_text LIKE 'enc:v1:%' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Timeline entries are append-only and cannot be modified.';
END;
$$ LANGUAGE plpgsql;
