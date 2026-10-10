-- FR-84: audit_events is append-only. UPDATE, DELETE and TRUNCATE are rejected at the database layer.
CREATE OR REPLACE FUNCTION block_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit events are immutable and append-only. Modification is strictly forbidden.';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_events_no_update ON audit_events;
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION block_audit_modification();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_events_no_delete ON audit_events;
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION block_audit_modification();
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_audit_events_no_truncate ON audit_events;
--> statement-breakpoint
CREATE TRIGGER trg_audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION block_audit_modification();
