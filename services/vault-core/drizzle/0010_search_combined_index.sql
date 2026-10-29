-- NFR-10 / NFR-13 / NFR-14: keyword search matched on (title || tags || chunk text) computed per row at
-- query time, which no index can serve, so every search scanned the whole vault. The same vector is now
-- stored and indexed. Matching and ranking rules are unchanged.

-- Title and tags of a page, as searched.
ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "meta_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "title") || COALESCE(vault_tags_tsv("tags"), ''::tsvector)) STORED;
--> statement-breakpoint
-- Title, tags and chunk text together: exactly what the search predicate tests for a chunk row.
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "search_tsv" tsvector;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION chunks_set_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_tsv := COALESCE((SELECT p.meta_tsv FROM pages p WHERE p.id = NEW.page_id), ''::tsvector)
                      || COALESCE(NEW.tsv_content, ''::tsvector);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chunks_search_tsv ON chunks;
--> statement-breakpoint
CREATE TRIGGER trg_chunks_search_tsv
BEFORE INSERT OR UPDATE OF tsv_content, page_id ON chunks
FOR EACH ROW
EXECUTE FUNCTION chunks_set_search_tsv();
--> statement-breakpoint
-- A rename or a tag change must reach the chunks of that page.
CREATE OR REPLACE FUNCTION pages_refresh_chunk_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chunks
       SET search_tsv = NEW.meta_tsv || COALESCE(tsv_content, ''::tsvector)
     WHERE page_id = NEW.id;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_pages_refresh_chunk_search_tsv ON pages;
--> statement-breakpoint
CREATE TRIGGER trg_pages_refresh_chunk_search_tsv
AFTER UPDATE OF title, tags ON pages
FOR EACH ROW
WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.tags IS DISTINCT FROM NEW.tags)
EXECUTE FUNCTION pages_refresh_chunk_search_tsv();
--> statement-breakpoint
UPDATE chunks c
   SET search_tsv = p.meta_tsv || COALESCE(c.tsv_content, ''::tsvector)
  FROM pages p
 WHERE p.id = c.page_id AND c.search_tsv IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_search_tsv" ON "chunks" USING gin ("search_tsv");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pages_meta_tsv" ON "pages" USING gin ("meta_tsv");
--> statement-breakpoint
-- Version visibility checks probe a page's chunks by version.
CREATE INDEX IF NOT EXISTS "idx_chunks_page_version" ON "chunks" ("page_id", "version_id");
