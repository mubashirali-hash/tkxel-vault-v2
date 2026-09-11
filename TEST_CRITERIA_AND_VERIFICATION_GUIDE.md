# tkxel Vault: Complete Test Criteria & Local Testing Guide

This document provides the complete, step-by-step test criteria, verification checklist, and hands-on testing procedures for running and evaluating **tkxel Vault** on your local machine.

---

## 🟢 Live Local Services (Currently Running)

| Service | Local URL | Description | Status |
| :--- | :--- | :--- | :--- |
| **Vault Admin Web App** | [http://localhost:3000](http://localhost:3000) | Full responsive UI: Editor, 2D Graph, Import, Sharing, Export, Audit Viewer | 🟢 **ACTIVE** |
| **Remote MCP Gateway** | [http://localhost:3001](http://localhost:3001) | Anthropic Streamable HTTP server (MCP 2025-11-25) | 🟢 **ACTIVE** |
| **MCP Health Check** | [http://localhost:3001/health](http://localhost:3001/health) | Gateway health status endpoint | 🟢 **ACTIVE** |

---

## 📋 Complete Test Criteria Matrix

The testing criteria are structured into **5 Critical Testing Domains**:

```mermaid
graph LR
    A[Test Criteria] --> B[1. Web App UI & Editor]
    A --> C[2. 2D Knowledge Graph]
    A --> D[3. Dual-Mode Export & Security]
    A --> E[4. Remote MCP Gateway]
    A --> F[5. 10 Acceptance Criteria]
```

---

## 🧪 Domain 1: Web App UI & Dual-Mode Segregation

Open [http://localhost:3000](http://localhost:3000) in your web browser.

### Test 1.1: Dual-Mode Vault Navigation & Visual Segregation
- **Objective:** Verify clear visual distinction and access boundaries between Open and Locked vaults.
- **Steps to Test:**
  1. Look at the top-left sidebar vault selector.
  2. Click on **Engineering Context Hub** (Open Vault):
     - Notice the **blue badge** labeled `Open Context Hub`.
     - Document tree displays pages with page type indicators.
  3. Switch to **Proprietary IP Skills** (Locked Vault):
     - Notice the **amber badge** with lock icon labeled `Locked Skills Store`.
     - Direct raw file browsing is omitted for consumers; administrative access rules apply.
- **Expected Outcome:** Vault mode is immediately obvious with distinct color tokens (Blue = Open, Amber = Locked).

### Test 1.2: WYSIWYG Editor & Front Matter Preservation
- **Objective:** Verify that the editor preserves clean Markdown and YAML front matter without corruption.
- **Steps to Test:**
  1. In the sidebar, select any document (e.g. `Architecture Blueprint` or `Getting Started Guide`).
  2. Inspect the **Document Settings (YAML Front Matter)** panel at the top:
     - Check `Title`, `Tags`, and `Aliases`.
     - Edit a tag (e.g., add `production`).
  3. Edit the Markdown body in the WYSIWYG editor:
     - Add a heading `# New Section`, bullet lists, or bold text.
  4. Click **Save Document**.
- **Expected Outcome:** YAML front matter and Markdown body are preserved with 100% fidelity without HTML/DOM tag leakage.

### Test 1.3: Sub-50ms Wiki-Link Autocomplete (`[[`)
- **Objective:** Test interactive link autocompletion and alias resolution.
- **Steps to Test:**
  1. In the editor body, type `[[`.
  2. A floating **Wiki-Link Autocomplete** picker appears instantly (<50ms).
  3. Type `sec` to filter for `Security Guidelines`.
  4. Use `ArrowDown` / `ArrowUp` and press `Enter` to select.
  5. The editor inserts `[[Security Guidelines]]`.
- **Expected Outcome:** Fast response, keyboard navigation, and seamless link insertion.

### Test 1.4: Universal Ingestion & Obsidian Vault Import
- **Objective:** Verify importing single Markdown files or entire Obsidian vaults.
- **Steps to Test:**
  1. In the top-right header, click **Workspace actions** and select **Import notes**.
  2. The universal importer modal opens.
  3. Drag and drop any `.md` file, ZIP file, or Obsidian directory.
  4. Click **Import to Vault**.
- **Expected Outcome:** Notes are ingested, YAML front matter and internal wiki-links are parsed into the 2D graph, while hidden `.obsidian/` metadata folders are cleanly ignored. An `import_vault` audit record is appended.

### Test 1.5: Data Persistence Across Page Refresh
- **Objective:** Verify state persists across browser reloads without data loss.
- **Steps to Test:**
  1. Create a note, add custom tags and an alias, or add a locked skill.
  2. Refresh the browser page (`F5` or `Ctrl+R`).
- **Expected Outcome:** All notes, links, custom categories, locked skills, and audit logs immediately reload from persistent browser storage.

---

## 🕸️ Domain 2: 2D Force-Directed Knowledge Graph & Local Graph

### Test 2.1: Full Knowledge Graph Exploration
- **Steps to Test:**
  1. In the top navigation bar, switch to the **Graph** tab.
  2. The interactive 2D force simulation renders:
     - Nodes are color-coded by page type (Decision = Emerald, Meeting = Purple, Project = Blue, Client = Amber, Person = Pink, Note = Cyan, plus dynamically generated HSL colors for any custom categories).
  3. Use canvas navigation controls:
     - Zoom in and out using mousewheel or toolbar **Zoom in** (`+`) and **Zoom out** (`-`) buttons.
     - Pan the entire canvas viewport by clicking and dragging on the canvas background.
     - Drag individual nodes to reposition them with smooth D3 velocity damping.
     - Click **Reset graph view** in the toolbar to center the view.
  4. Test category filtering & scope:
     - Toggle between **Local neighborhood** and **Entire vault** scope.
     - Select a type filter from the **Type** dropdown to isolate nodes.
     - In the graph search bar, type a keyword to highlight matching nodes.
  5. Hover over any node: a smooth preview card displays title, category, and direct connection highlight without glitching.
  6. Right-click any node to reveal the context menu (`Link to another note...`, `Open in Editor`, `Copy [[wikilink]]`).
  7. Click any node to navigate directly to it in the editor.
- **Expected Outcome:** Hardware-accelerated canvas simulation, smooth pan/zoom, interactive node dragging, scope switching, and instant note opening.

### Test 2.2: Local Two-Hop Neighborhood Graph View
- **Steps to Test:**
  1. Select any document in the **Notes** editor view.
  2. Click the Note Summary pill to open the slide-over **Note Inspector** drawer, and switch to the **Local Graph** tab (or inspect the mounted local graph below the editor body).
  3. Notice it renders only the focal document and its direct 1-hop and 2-hop connected neighbors.
- **Expected Outcome:** Instant local contextual graph isolation focused on the active note.

---

## 🔒 Domain 3: Dual-Mode Export & Security Controls

### Test 3.1: Open Vault Owner-Only Audited Export (Real ZIP & CSV Downloads)
- **Steps to Test:**
  1. Switch active vault to **Engineering Knowledge Hub** (Open Vault).
  2. Ensure your active role is set to `Owner`.
  3. In the top-right header, click **Workspace actions** and select **Export vault**.
  4. The Export Modal opens:
     - Notice export is permitted because your active role is `Owner`.
     - Enter mandatory justification: `Quarterly security compliance backup`.
     - Click **Download ZIP Archive**.
  5. Check browser downloads: a real `.zip` archive (`engineering-knowledge-hub-notes.zip`) is downloaded with all notes and YAML front matter intact.
  6. Switch to the **Activity & Audit** tab: verify an immutable `export_open_vault` event is recorded.
  7. In Activity & Audit, click **Export CSV**: a real `.csv` file downloads with timestamped audit events.
- **Expected Outcome:** Open Vault exports succeed for Owners with genuine file downloads and complete audit logging.

### Test 3.2: Role Gating & Locked Vault Export Prohibition (All Roles)
- **Steps to Test:**
  1. Switch role to `Reader`:
     - As `Reader`, editing, deleting, importing, and exporting are disabled.
  2. Switch active vault to **Proprietary IP & Skills Store** (Locked Vault):
     - The `Graph` tab is completely unmounted, and the `Notes` tab is replaced by `Skills`.
     - In **Workspace actions**, selecting **Export vault** displays an explicit security denial banner explaining bulk export is permanently disabled for locked vaults.
- **Expected Outcome:** Strict role enforcement and permanent export prohibition on locked vaults across all roles.

---

## 📡 Domain 4: Remote MCP Gateway Verification

Open PowerShell or your terminal and test the live MCP Gateway running on `http://localhost:3001`:

### Test 4.1: Gateway Health Check
```powershell
Invoke-RestMethod -Uri http://localhost:3001/health
```
- **Expected Response:**
  ```json
  { "status": "ok", "service": "tkxel-vault-mcp-gateway" }
  ```

### Test 4.2: Streamable HTTP Transport Handshake (Initialize)
```powershell
$headers = @{
    "Authorization" = "Bearer dev-sso-token-reader"
    "Content-Type" = "application/json"
}
$body = @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
        protocolVersion = "2025-11-25"
        capabilities = @{}
        clientInfo = @{ name = "Claude-Desktop"; version = "1.0.0" }
    }
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3001/mcp -Method Post -Headers $headers -Body $body
```
- **Expected Response:** JSON-RPC 2.0 response confirming `protocolVersion: "2025-11-25"` and server capabilities.

### Test 4.3: Dynamic Tool Listing (`tools/list`)
```powershell
$bodyTools = @{
    jsonrpc = "2.0"
    id = 2
    method = "tools/list"
    params = @{}
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:3001/mcp -Method Post -Headers $headers -Body $bodyTools
```
- **Expected Response:** Dynamically computed tool palette matching the caller's OAuth claims.

---

## 🛡️ Domain 5: Automated 10 Acceptance Criteria Suite

Run the full end-to-end acceptance suite from your repository root:

```powershell
node --test scripts/verify-acceptance-criteria.js
```

### Expected Output:
```text
▶ SRS Section 9: 10 Acceptance Criteria Verification
  ✔ AC-1: Context Retrieval Flow - 3 linked pages retrieved and synthesized with citations
  ✔ AC-2: Link Refactoring Integrity - renaming page refactors wiki-links dynamically without broken links
  ✔ AC-3: Bulk Vault Migration - Obsidian vault export preserves front matter, tags, formatting, and links
  ✔ AC-4: Locked Skill Execution - Consumer executes locked skill through Claude without source exposure
  ✔ AC-5: Prompt Exfiltration Defense - 20+ adversarial probes rejected without leaking instructions
  ✔ AC-6: Strict Multi-Tenant Isolation - Reader in Vault A cannot discover titles or contents of Vault B
  ✔ AC-7: Rapid Revocation Enforcement - User access revocation severs MCP access within 60s
  ✔ AC-8: Automated SSO Deprovisioning - Account deactivation terminates active sessions immediately
  ✔ AC-9: Penetration Test Verification - Consumer tokens cannot escalate to raw Markdown files
  ✔ AC-10: Zero-Plaintext Storage Audit & Dual Export Validation - 100% ciphertext and strict export policy
✔ SRS Section 9: 10 Acceptance Criteria Verification (10/10 PASS)
```

### Full Monorepo Test Suite:
```powershell
pnpm turbo run test
```
- **Expected Result:** 90 tests passing, 0 failures across all 5 workspace projects (100% green).
