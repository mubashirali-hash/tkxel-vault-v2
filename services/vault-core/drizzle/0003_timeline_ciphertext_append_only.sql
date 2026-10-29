-- FR-06 / NFR-01: timeline entries are append-only and stored as ciphertext.
-- NOT VALID enforces the rule for every new row without failing on rows written before encryption existed.
ALTER TABLE timeline_entries
  ADD CONSTRAINT timeline_entry_text_is_ciphertext CHECK (entry_text LIKE 'enc:v1:%') NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION block_timeline_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Timeline entries are append-only and cannot be modified.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_timeline_entries_no_update ON timeline_entries;
--> statement-breakpoint
CREATE TRIGGER trg_timeline_entries_no_update
BEFORE UPDATE ON timeline_entries
FOR EACH ROW
EXECUTE FUNCTION block_timeline_update();
