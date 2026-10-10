-- NFR-10 / NFR-13: GIN "fastupdate" parks newly inserted rows in a pending list that every search has
-- to scan in full until autovacuum folds it into the index. After an import or a burst of edits that
-- made search latency jump from tens of milliseconds to seconds at random. Search is read far more
-- often than pages are written, so the indexes are maintained at write time instead.
ALTER INDEX IF EXISTS "idx_chunks_search_tsv" SET (fastupdate = off);
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_pages_meta_tsv" SET (fastupdate = off);
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_chunks_tsv_content" SET (fastupdate = off);
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_pages_title_tsv" SET (fastupdate = off);
--> statement-breakpoint
ALTER INDEX IF EXISTS "idx_pages_tags_tsv" SET (fastupdate = off);
--> statement-breakpoint
-- Fold in whatever is already pending.
SELECT gin_clean_pending_list('idx_chunks_search_tsv'::regclass), gin_clean_pending_list('idx_pages_meta_tsv'::regclass);
