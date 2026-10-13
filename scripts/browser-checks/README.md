# Browser checks

Most of the web app's unit tests read source text, so they cannot see a control that renders but does not work. These scripts drive the running app in a real browser and check the result on the server.

| Script | What it covers |
| :--- | :--- |
| `notes-and-vault-features.mjs` | Edit, autosave and publish; version history, comparison and restore; timeline entries; image upload; moving a note to another vault; exporting a vault; the convert-to-skill dialog |
| `locked-conflict-mobile-graph.mjs` | Reference pages in a locked vault; two people editing one note; a vault whose key cannot be unwrapped; phone-sized layout; the graph with 2,000 notes |
| `emergency-access.mjs` | An administrator asks for emergency access to a locked vault, the Owner approves and revokes, and each step is audited |

## Running them

1. Start the API and the web app in development mode with the local sign-in enabled (`ENABLE_DEV_AUTH_BYPASS=true` on the API, `VITE_ENABLE_DEV_AUTH_BYPASS=true` on the web app).
2. Playwright is not a dependency of this repository. Point `PLAYWRIGHT_MODULE_DIR` at any folder whose `node_modules` contains `playwright-core`; the checks use the installed Chrome.
3. Run a script with Node 22 or newer, optionally naming the groups to run:

```bash
PLAYWRIGHT_MODULE_DIR=/path/with/node_modules node scripts/browser-checks/notes-and-vault-features.mjs
PLAYWRIGHT_MODULE_DIR=/path/with/node_modules node scripts/browser-checks/locked-conflict-mobile-graph.mjs conflict mobile
```

`APP_URL` and `API_URL` override the default addresses (`http://localhost:3000`, `http://localhost:3012/api`).

Each script creates vaults whose names start with `QA ` and removes them when it finishes. They write to the database the API is connected to, so run them against a development database only. `emergency-access.mjs` starts its own second API instance on port 3013 with an administrator configured, and needs the API to be built (`pnpm --filter @tkxel-vault/api-server build`).
