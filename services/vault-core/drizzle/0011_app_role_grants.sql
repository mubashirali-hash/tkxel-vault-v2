-- FR-84 / AC-6: services must not connect as the database owner or a superuser. A table owner can drop
-- or disable the append-only triggers; a role holding only data privileges cannot.
--
-- tkxel_grant_app_role(role) gives an existing login role exactly what the services need at run time:
-- read and write rows, nothing that changes the schema, and no way to rewrite or remove audit events.
-- It is called by whoever owns the schema (the migration role), never by the application.
CREATE OR REPLACE FUNCTION tkxel_grant_app_role(app_role name)
RETURNS void AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        RAISE EXCEPTION 'Role % does not exist', app_role;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls)) THEN
        RAISE EXCEPTION 'Role % has administrative attributes and cannot be used as the application role', app_role;
    END IF;

    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app_role);
    EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', app_role);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', app_role);
    -- Tables added by later migrations (run by the current role) are covered automatically
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', app_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', app_role);

    -- The audit trail is insert-and-read only for the application, by privilege as well as by trigger
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM %I', app_role);
    -- Only the schema owner grants privileges
    EXECUTE format('REVOKE EXECUTE ON FUNCTION tkxel_grant_app_role(name) FROM %I', app_role);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION tkxel_grant_app_role(name) FROM PUBLIC;
--> statement-breakpoint
-- Deployments that created the conventional role before migrating get their grants here.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tkxel_app') THEN
        PERFORM tkxel_grant_app_role('tkxel_app');
    END IF;
END $$;
