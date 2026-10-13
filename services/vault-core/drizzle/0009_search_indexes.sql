-- NFR-10 / NFR-13 / NFR-14: let keyword search find candidate pages through indexes instead of scanning
-- every page of a vault. Ranking and matching rules are unchanged; these only narrow what is examined.
CREATE INDEX IF NOT EXISTS "idx_chunks_tsv_content" ON "chunks" USING gin ("tsv_content");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_title_tsv" ON "pages" USING gin (to_tsvector('english', "title"));
--> statement-breakpoint
-- array_to_string is not IMMUTABLE, so the tag vector needs a wrapper before it can be indexed.
-- The body is fixed to the 'english' configuration and has no other dependency, which makes it safe to mark IMMUTABLE.
CREATE OR REPLACE FUNCTION vault_tags_tsv(tags text[])
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT to_tsvector('english', array_to_string(tags, ' ')) $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_tags_tsv" ON "pages" USING gin (vault_tags_tsv("tags"));
