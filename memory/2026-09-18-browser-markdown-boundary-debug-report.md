# Debug Report: Browser Markdown Boundary

- **Symptom:** The web app failed at startup because Vite externalized Node's `events` module and the generated client bundle referenced the unavailable `Buffer` global.
- **Root cause:** `@tkxel-vault/vault-core/markdown` re-exported the database-backed `LinkGraphIndexer`. Browser imports of the otherwise safe parser/importer barrel therefore pulled `drizzle-orm`, `pg`, and their Node-only dependencies into the client bundle.
- **Fix:** Removed the indexer re-export from the browser-facing markdown barrel. The server entry continues to export `LinkGraphIndexer` for backend consumers.
- **Evidence:** The web-app suite passed 125/125 tests; web-app TypeScript completed with exit status 0; Vite transformed 4,251 modules and completed the production build in 47.76 seconds; a post-build scan found no browser-external `events`, PostgreSQL, or `Buffer.allocUnsafe` signatures in client assets.
- **Regression test:** `apps/web-app/test/browser-module-boundary.test.js` guards both sides of the boundary.
- **Related:** The indexer export was a local uncommitted addition to the markdown barrel; no earlier matching incident was recorded in project memory.
- **Status:** DONE
