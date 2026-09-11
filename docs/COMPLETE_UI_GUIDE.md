# tkxel Vault: Complete Web Application UI & Operational Guide

**Document Version:** 3.0 (Post-Redesign Comprehensive Platform Manual — UXR-09)  
**Target Application:** `apps/web-app` (Vault Admin Web App, Live WYSIWYG Editor, 2D Knowledge Graph & Remote MCP Gateway)  
**System Theme:** tkxel Blue Horizon (High-Contrast B2B Electric Blue `#0755E9`, Crisp Canvas, & Responsive Shell)  
**Authoritative References:**
- Technical Requirements: [`tkxel_vault_SRS.md`](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md)
- Product Vision & Roadmaps: [`tkxel_vault_PRD.md`](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md)
- Design Tokens & Application Patterns: [`DESIGN.md`](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/DESIGN.md)
- QA Defect Audit & Discrepancies: [`docs/UI_QA_ISSUES_REPORT.md`](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/docs/UI_QA_ISSUES_REPORT.md)
- Architecture Decision Records: `docs/adr/ADR-010-*.md` through `ADR-016-*.md`

---

## 1. System Philosophy & Dual-Mode Vault Paradigm

The **tkxel Vault Admin Web Application** provides an enterprise-grade graphical workspace designed for managing, authoring, interconnecting, and securing institutional intelligence. The application operates under a strict **Dual-Mode Vault Architecture**:

```
+----------------------------------------------------------------------------------------------------+
|                                    tkxel Vault Dual-Mode Paradigm                                  |
+--------------------------------------------------+-------------------------------------------------+
|               1. OPEN CONTEXT HUB                |           2. ZERO-READ LOCKED SKILLS STORE      |
+--------------------------------------------------+-------------------------------------------------+
| • Primary Accent: Electric Blue (#0755E9)        | • Primary Accent: Burnt Orange (#EA580C)        |
| • Purpose: Enterprise Knowledge & Documentation   | • Purpose: Proprietary IP & AI Skill Execution   |
| • Browsing: Full text, note trees, backlinks     | • Browsing: Metadata only; zero raw file reading|
| • Navigation: Notes, Graph, Activity & Audit     | • Navigation: Skills, Activity & Audit (No Graph)|
| • Knowledge Graph: Interactive 2D Canvas         | • Knowledge Graph: Completely hidden per policy |
| • Export Policy: Permitted for Owners (Audited)   | • Export Policy: Strictly Forbidden for all     |
| • Consumers/Readers: Read, search, cite context  | • Consumers: Run skills via Claude MCP only     |
+--------------------------------------------------+-------------------------------------------------+
```

### Security Invariants Preserved in UI:
1. **Invariant 1 (Vault Isolation & Mode Segregation):** In Locked Vaults, the Knowledge Graph tab is completely unmounted. Raw markdown notes cannot be read, listed, or exported.
2. **Invariant 2 (Cryptographic Zero-Trust):** All vault data is encrypted at rest using AES-256-GCM. Secret prompts and execution payloads are decrypted only inside ephemeral, in-memory sandboxes and never touch persistent browser storage.
3. **Invariant 3 (MCP Standard Compliance):** Connected AI agents (Claude.ai, Claude Desktop, Cursor) connect via Anthropic Streamable HTTP protocol (2025-11-25) or standard JSON-RPC 2.0 stdio bridge with dynamic role-filtered tool catalogs.

---

## 2. Layout Anatomy & Responsive Shell Architecture

The web application adapts fluidly across three primary viewport tiers:
- **Wide Desktop (≥ 1280px):** Persistent navigation sidebar, centered reading column with inspector rail, full-screen canvas views.
- **Compact Desktop & Tablet (900px – 1279px):** Collapsible sidebar rail, full-width responsive editor with slide-over drawer inspector.
- **Mobile (< 900px):** Top header with drawer toggle, slide-out navigation drawer with focus containment, fixed bottom navigation bar (`Notes`/`Skills`, `Graph`, `Activity`, `Browse`).

```text
+---------------------------------------------------------------------------------------------------------+
| [HEADER BAR: Nav Toggle | Vault Switcher | Primary View Tabs | Workspace Actions Menu | User Account]   |
+------------------------------------+--------------------------------------------------------------------+
| [COLLAPSIBLE SIDEBAR / DRAWER]     | [MAIN WORKSPACE VIEWPORT]                                          |
|                                    |                                                                    |
| Open Vault Mode:                   | View 1: "Notes" (Live Inline TipTap WYSIWYG Editor)                |
| • New note (+ Button)              |   • Document Title & Draft Save State Indicator                    |
| • Search notes and tags            |   • Actions: Save Draft, Publish, AI Co-Pilot, More note actions   |
| • Scrollable Note list             |   • Inline TipTap Editor (H1-H3, Bold, Italic, Lists, Quotes, Code)|
| • Per-row: Protect, Delete actions |   • Caret-anchored [[WikiLinkPicker]] popup                        |
|                                    |   • Note Summary Pill (toggles collapsible Note Inspector drawer)  |
| Locked Vault Mode:                 |                                                                    |
| • Zero-Read Security Banner        | View 2: "Graph" (2D Hardware-Accelerated Force Graph)              |
| • In-memory execution notice      |   • Toolbar: Search, Scope (Local/Entire), Type Filter, Zoom, Fit  |
| • AES-256-GCM sealed indicator     |   • Interactive Canvas: Node drag physics, Shift+Drag link gesture |
|                                    |   • Right-click context menu: Link, Open in Editor, Copy wikilink  |
|                                    |                                                                    |
|                                    | View 3: "Activity & Audit" (Human-Readable Forensic Ledger)         |
|                                    |   • Search, Action Filter, Actor Filter, Outcome, Date Range       |
|                                    |   • Tabular audit events with relative timestamps & status badges  |
|                                    |   • Expandable Event Details drawer with JSON payload inspection   |
|                                    |   • Export CSV Action                                              |
|                                    |                                                                    |
|                                    | View 4: "Skills" (Locked Vaults Only)                              |
|                                    |   • Zero-read explanation banner & "Add protected skill" button    |
|                                    |   • Telemetry cards: MCP Gateway, Encryption, Sandbox Status       |
|                                    |   • Protected skills catalog with "Copy invocation"                |
+------------------------------------+--------------------------------------------------------------------+
| [MOBILE BOTTOM NAV (< 900px): Notes/Skills | Graph | Activity | Browse (Drawer)]                       |
+---------------------------------------------------------------------------------------------------------+
```

---

## 3. Exhaustive Button-by-Button Operational Catalog

This catalog documents every interactive control across the redesigned application.

---

### 3.1 Global Header & Responsive Navigation (`components/layout/AppShell.tsx`)

#### 1. Navigation Drawer Toggle Button
- **Location:** Header far-left (visible on screens < 900px or when sidebar is collapsed).
- **Icon / Label:** `PanelLeftOpen` / `PanelLeftClose` (desktop), `Menu` (mobile); `aria-label="Open notes navigation"` / `"Close notes navigation"`.
- **Role Permissions:** Permitted for all authenticated users.
- **Current Behavior:** Toggles `navigationOpen` state to reveal or hide the slide-out navigation drawer with smooth animation.
- **Specification:** Reveal sidebar on mobile devices and compact viewports without causing layout horizontal shifting.

#### 2. Vault Selector Dropdown Button
- **Location:** Header left, adjacent to brand identity.
- **Icon / Label:** `BookOpen` (Electric Blue) for Open Vaults or `Lock` (Burnt Orange) for Locked Vaults, active vault title, mode badge (`Open Vault` or `Locked IP Store`), and `ChevronDown`.
- **Role Permissions:** Permitted for all authenticated users.
- **Current Behavior:** Toggles `vaultDropdownOpen` menu popover (`aria-haspopup="listbox"`, `aria-expanded`).
- **Specification:** Allow immediate workspace switching between enterprise Open Knowledge Hubs and Zero-Read Locked Skill Stores.

#### 3. Vault Selector Menu Items
- **Location:** Inside Vault Selector popover menu.
- **Current Behavior:** Clicking a vault row calls `onSelectVault(vault)`. If the user is Workspace Owner, renders a secondary shortcut button `"Manage access"`.
- **Specification:** Instantly filter workspace state to the chosen vault, updating active pages, graph nodes, and permissible navigation tabs. Switching to a locked vault immediately hides the Graph tab.

#### 4. Primary View Tab: "Notes" / "Skills"
- **Location:** Header center navigation bar (`app-view-tabs`).
- **Icon / Label:**
  - **Open Vault:** `FileText` + `Notes`.
  - **Locked Vault:** `Lock` + `Skills`.
- **Role Permissions:** All authenticated roles in the vault.
- **Current Behavior:** Calls `onSelectTab('editor')`. Renders the Live WYSIWYG Editor in Open Vaults, or the Protected Skills Catalog in Locked Vaults.

#### 5. Primary View Tab: "Graph"
- **Location:** Header center navigation bar.
- **Icon / Label:** `Network` + `Graph`.
- **Role Permissions:** Permitted for Open Vault members (Owner, Editor, Reader).
- **Current Behavior:** Calls `onSelectTab('graph')`. Mounts the 2D Force-Directed Knowledge Graph.
- **Security Invariant:** **Strictly unmounted in Locked Vaults** (`isOpenVault && ...`).

#### 6. Primary View Tab: "Activity & Audit"
- **Location:** Header center navigation bar.
- **Icon / Label:** `History` + `Activity & Audit`.
- **Role Permissions:** Permitted for all roles (records are filtered according to governance policy).
- **Current Behavior:** Calls `onSelectTab('audit')`. Mounts the human-readable forensic activity ledger.

#### 7. Workspace Actions Menu ("Workspace actions")
- **Location:** Header right, before user account menu.
- **Icon / Label:** `ActionMenu` trigger labeled `"Workspace actions"` with `SlidersHorizontal` / `MoreVertical` icon.
- **Available Menu Items:**
  - **`Import notes`:** `Upload` icon. Permitted for Owner and Editor on Open Vaults. Opens `ImporterModal.tsx`.
  - **`Share and access`:** `Share2` icon. Permitted exclusively for Workspace Owner. Opens `SharingModal.tsx`.
  - **`Integrations`:** `Bot` icon. Permitted for all roles. Opens `McpConnectModal.tsx` for Claude/Cursor setup.
  - **`Export vault`:** `Download` icon. Permitted exclusively for Workspace Owner on Open Vaults. Opens `ExportModal.tsx`. Disabled/forbidden on Locked Vaults.

#### 8. User Account Trigger & Popover
- **Location:** Header far-right.
- **Icon / Label:** User avatar circle (initials or photo), user name/email, role badge (`Owner`, `Editor`, `Reader`, `Consumer`), `ChevronDown`.
- **Popover Contents:**
  - User identity display (Name and email).
  - `Manage access`: Permitted for Owner. Opens `SharingModal.tsx`.
  - `Sign out`: Calls `onLogout()`, clears session token (`localStorage.removeItem('ssoToken')`), and resets auth state.

#### 9. Mobile Bottom Navigation Bar (`app-mobile-nav`)
- **Location:** Fixed viewport bottom on screens < 900px.
- **Buttons:**
  - Open Vault: `Notes` (`FileText`), `Graph` (`Network`), `Activity` (`History`), `Browse` (`Menu`).
  - Locked Vault: `Skills` (`Lock`), `Activity` (`History`), `Browse` (`Menu`).
- **Behavior:** Quick thumb-driven tab switching; `Browse` opens the slide-out navigation drawer with focus management.

---

### 3.2 Contextual Notes Navigation Sidebar (`components/navigation/Sidebar.tsx`)

#### 10. "New note" Primary Button
- **Location:** Top of sidebar controls.
- **Icon / Label:** `Plus` + `New note` (`Button variant="primary"`).
- **Role Permissions:** Permitted for Owner and Editor in Open Vaults. Hidden for Reader.
- **Current Behavior:** Creates a new untitled document (`pg_<timestamp>`), adds it to the active vault list, selects it, focuses the editor title input, and closes the mobile drawer if open.

#### 11. Notes and Tags Search Input
- **Location:** Sidebar controls below "New note".
- **Icon / Label:** `Search` icon + placeholder `"Search notes and tags"` (`type="search"`).
- **Behavior:** Debounced live search (250ms). Calls `GET /api/search?vaultId=...&q=...` with automatic client-side fallback matching note titles and `#tags`.

#### 12. Note Row Item
- **Location:** Inside scrollable sidebar note list.
- **Appearance:** `FileText` icon, note title (bold), and top tag chips (`#tag`).
- **Behavior:** Clicking row selects the note, loads content into the editor, and updates active note state.

#### 13. Note Row Action: Create Protected Skill
- **Location:** Hover action on note row (visible to Owner/Editor).
- **Icon / Label:** `Sparkles` icon (`aria-label="Create protected skill from note"`).
- **Behavior:** Opens `ConvertNoteToSkillModal.tsx` pre-populated with note title, content, and parsed inputs.

#### 14. Note Row Action: Delete Note
- **Location:** Hover action on note row (visible to Owner/Editor).
- **Icon / Label:** `Trash2` icon (`aria-label="Delete note"`).
- **Behavior:** Opens accessible confirmation dialog. Upon confirmation, deletes page, cascades link removal, and records an audited event.

---

### 3.3 Focused Authoring & Live WYSIWYG Editor (`components/editor/MarkdownEditor.tsx`)

#### 15. Document Title Input
- **Location:** Top of editor workspace.
- **Appearance:** Large borderless typography input (`placeholder="Untitled Document"`).
- **Behavior:** Updates note title. If note has existing links, renaming triggers `MarkdownEngine.refactorLinks()` across all vault notes to prevent broken wiki-links.

#### 16. Save State Indicator
- **Location:** Action bar left.
- **Appearance:** Pill badge with `Check` icon displaying:
  - `"Draft saved"` (green) when local draft is synchronized.
  - `"Unsaved draft"` (amber) when modifications are pending.
  - `"Offline — changes stay here"` when network is disconnected.

#### 17. "Save Draft" Button
- **Location:** Editor action bar.
- **Icon / Label:** `Save` + `Save Draft` (`btn-secondary-white`).
- **Behavior:** Explicitly persists draft changes to local storage and backend `/api/save` without publishing a formal version.

#### 18. "Publish" Button
- **Location:** Editor action bar.
- **Icon / Label:** `Check` + `Publish` (`btn-primary-blue`).
- **Behavior:** Creates an immutable numbered version snapshot in the version timeline, clears draft dirty status, and logs a `publish_version` audit event.

#### 19. "AI Co-Pilot" Toggle Button
- **Location:** Editor action bar.
- **Icon / Label:** `Sparkles` + `AI Co-Pilot`.
- **Behavior:** Toggles the collapsible `NotesAiDrawer.tsx` side panel for auto-linking suggestions, taxonomy auto-tagging, Q&A, and skill drafting.

#### 20. "More note actions" Overflow Menu (`ActionMenu`)
- **Location:** Editor action bar far-right.
- **Menu Items:**
  - **`View changes`:** `Eye` icon. Opens `DiffViewer.tsx` to compare current draft against latest published version with line-level diffing.
  - **`Note details`:** `ArrowUpRight` icon. Opens Note Inspector drawer to the Properties tab.
  - **`Create protected skill`:** `Sparkles` icon (Open Vaults only). Opens `ConvertNoteToSkillModal.tsx`.
  - **`Delete note`:** `Trash2` icon (destructive). Prompts accessible confirmation dialog to delete active note.

#### 21. Note Summary Pill Button
- **Location:** Below title bar.
- **Appearance:** Clickable metadata strip showing `[Category] · [N tags] · [N aliases] · [N backlinks]`.
- **Behavior:** Opens the slide-over Note Inspector drawer (`NoteInspector.tsx`) focused on note properties.

#### 22. TipTap Formatting Toolbar
- **Location:** Floating or anchored toolbar above document body.
- **Controls:** Headings (H1, H2, H3), Bold (`Bold`), Italic (`Italic`), Strikethrough (`Strikethrough`), Code inline (`Code`), Bullet List (`List`), Ordered List (`ListOrdered`), Blockquote (`Quote`), Link (`Link`), and Horizontal Rule (`Minus`).
- **Behavior:** Direct inline formatting applied instantly to selection; markdown syntax generated cleanly in background.

#### 23. Caret-Anchored WikiLink Autocomplete (`WikiLinkPicker.tsx`)
- **Location:** Anchored dynamically at caret position when typing `[[`.
- **Behavior:** Displays matching vault notes and aliases. Supports keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`). Selecting an item inserts `[[Note Title]]` and dismisses popover.

---

### 3.4 Note Inspector Drawer (`components/editor/NoteInspector.tsx`)

#### 24. Inspector Tabs
- **Tabs:** `Properties`, `Backlinks`, `History`, `Local Graph`.
- **Behavior:** Switches inspector panel view:
  - **`Properties`:** Category dropdown selector, custom category creator (`+ Add Custom Category...`), tag editor chip input, and alias chip input.
  - **`Backlinks`:** List of notes referencing the active note (`[[wikilinks]]`), clickable to navigate directly.
  - **`History`:** Chronological version timeline showing timestamp, author, version number, and "Compare with draft" action.
  - **`Local Graph`:** Interactive 2-hop neighborhood graph showing immediate neighbors and 2nd-degree connections.

---

### 3.5 Version Comparison Diff Viewer (`components/editor/DiffViewer.tsx`)

#### 25. Line-Level Syntax Diff
- **Location:** Inside Diff Viewer modal.
- **Appearance:** Unified or side-by-side view with line numbers and color-coded change indicators (`+` green for additions, `-` red for deletions, neutral for unchanged lines).
- **Actions:**
  - **`Revert to published`:** Discards uncommitted draft changes and restores the latest published version snapshot.
  - **`Close`:** Dismisses diff dialog.

---

### 3.6 Interactive 2D Knowledge Graph (`components/graph/KnowledgeGraph.tsx` & `GraphToolbar.tsx`)

#### 26. Graph Search Input
- **Location:** Graph toolbar left.
- **Icon / Label:** `Search` icon + placeholder `"Find a note…"`.
- **Behavior:** Live-filters graph nodes; matching nodes are highlighted and non-matching nodes dimmed.

#### 27. Scope Switcher ("Graph scope")
- **Location:** Graph toolbar center.
- **Controls:** Segmented buttons `"Local neighborhood"` (2-hop from active note) vs `"Entire vault"`.
- **Behavior:** Restricts graph visualization to immediate context or displays the entire institutional graph.

#### 28. Category / Type Filter Dropdown
- **Location:** Graph toolbar.
- **Options:** `"All types"`, plus active vault categories (`note`, `decision`, `meeting`, `project`, `client`, `person`).
- **Behavior:** Filters visible nodes by assigned note category.

#### 29. Graph Note Count Indicator
- **Location:** Graph toolbar.
- **Appearance:** `aria-live="polite"` indicator showing `"{resultCount} of {totalCount} notes"`.

#### 30. "Connect notes" Mode Toggle
- **Location:** Graph toolbar.
- **Icon / Label:** `Link2` + `"Connect notes"` (or `"Cancel linking"` when active).
- **Behavior:** Enters visual connection mode. Dragging between two nodes creates a bidirectional `[[wikilink]]` edge.

#### 31. Viewport Zoom & Reset Controls
- **Location:** Graph toolbar right.
- **Buttons:**
  - `Zoom in` (`ZoomIn` icon).
  - `Zoom out` (`ZoomOut` icon).
  - `Fit selected note` (`Focus` icon, auto-pans and zooms to center the active node).
  - `Reset graph view` (`RotateCcw` icon, resets pan and zoom to default bounds).

#### 32. Interactive Canvas Gestures & Context Menu
- **Left Drag:** Freehand node dragging with force simulation relaxation; canvas pan when dragging background.
- **Shift + Drag:** Rubber-band link line connecting source node to target node.
- **Right Click on Node:** Opens context menu with:
  - `Link to another note...`: Opens quick note picker.
  - `Open in Editor`: Navigates to note in Live WYSIWYG Editor.
  - `Copy [[wikilink]]`: Copies `[[Note Title]]` to clipboard with toast confirmation.
- **Node Click:** Selects note, centers node, and opens `GraphInspector.tsx` side rail.

---

### 3.7 Humanized Activity & Tamper-Proof Audit Ledger (`components/audit/AuditViewer.tsx`)

#### 33. Activity Search & Filters
- **Location:** Top of Activity & Audit view.
- **Controls:**
  - Search: `"Filter activity..."` (searches actor, action label, target name).
  - Action Filter: Dropdown of humanized actions (e.g., "Created a note", "Shared vault access", "Blocked a tool request").
  - Actor Filter: Dropdown of recorded actors.
  - Outcome Filter: `"All outcomes"`, `"Successful operations"`, `"Blocked or alerted"`.
  - Date Filter: `"All time"`, `"Last 24 hours"`, `"Last 7 days"`, `"Last 30 days"`.

#### 34. Humanized Audit Event Row
- **Appearance:** Table row with:
  - **Actor:** User name / email.
  - **Action & Target:** Plain-language phrase (e.g., "Created a note: Architecture Review").
  - **Time:** Relative human time (e.g., "2 hours ago") with tooltip displaying exact ISO-8601 timestamp.
  - **Status Badge:** `success` (`ShieldCheck` green) or `attention` (`AlertTriangle` amber/red).

#### 35. Event Details Drawer
- **Trigger:** Clicking an audit event row.
- **Contents:** Slide-over drawer displaying full forensic record: Event ID, Vault ID, Actor ID, Target ID, Client IP address, User Agent string, and syntax-highlighted JSON metadata payload.

#### 36. "Export CSV" Action Button
- **Location:** Activity & Audit header top-right.
- **Icon / Label:** `Download` + `"Export CSV"`.
- **Behavior:** Generates an immediate RFC 4180-compliant `.csv` download containing all filtered audit records.

---

### 3.8 Zero-Read Protected Skills Catalog (`apps/web-app/src/App.tsx`)

#### 37. Zero-Read Security Banner
- **Location:** Top of Skills view in Locked Vaults.
- **Appearance:** Burnt Orange `#EA580C` banner with `Lock` icon, explaining: *"Run approved capabilities without exposing their instructions or source content."*
- **Disclosures:** Expandable `<details>` explaining AES-256-GCM sealed rest encryption, isolated memory sandbox execution, and complete prohibition on file listings and raw reading.

#### 38. "Add protected skill" Button
- **Location:** Skills banner right (visible to Owner/Editor).
- **Icon / Label:** `Plus` + `"Add protected skill"`.
- **Behavior:** Opens `AddSkillModal.tsx` to author a new encrypted skill package (title, description, parameter schemas, and execution prompt).

#### 39. Telemetry Cards
- **Panels:**
  - **MCP GATEWAY STATUS:** "Streamable HTTP Active", Anthropic Spec 2025-11-25.
  - **ENCRYPTION INVARIANT:** "AES-256-GCM Sealed", Zero Raw Disk Exfiltration.
  - **ISOLATION ENGINE:** "In-Memory Sandbox", 120s Timeout Enforced.

#### 40. Skill Card / Row Actions
- **`Copy invocation`:** Copies `claude: run_skill("<skill_name>", { ... })` invocation snippet to clipboard with 2-second visual checkmark confirmation.
- **`Delete skill`:** Destructive action (visible to Owner/Editor) with confirmation dialog.

---

### 3.9 Centralized Integrations & MCP Gateway Dialog (`components/mcp/McpConnectModal.tsx`)

#### 41. Gateway Health Probe & Protocol Tabs
- **Location:** Integrations modal.
- **Health Badge:** Real-time pulse indicator checking `GET /health` on the MCP Gateway (Green: `Connected (port 3002)`, Red: `Offline`).
- **Client Configuration Tabs:**
  - **Claude Desktop:** Ready-to-copy JSON configuration snippet using portable execution path `<TKXEL_VAULT_ROOT>/services/mcp-gateway/dist/stdio.js`.
  - **Cursor / Claude Code:** Portable command instructions.
  - **Remote HTTP (Claude.ai Custom Connector):** Streamable HTTP URL endpoint and OAuth 2.1 PKCE authorization endpoint.
- **Dynamic Tool Matrix:** Displays accessible tools filtered by active user role:
  - Open Vault Reader: `search`, `get_page`, `get_links`, `get_context`.
  - Open Vault Editor/Owner: Above tools plus `add_note`.
  - Locked Vault Consumer: `run_skill`, `ask_vault`, `list_skills` (zero raw reading).

---

### 3.10 Vault Sharing & Access Governance Modal (`components/sharing/SharingModal.tsx`)

#### 42. Active Shares List & Grant Form
- **Location:** Workspace Actions -> `Share and access` (Owner only).
- **Grant Form:** Email input + Role selector (`Editor`, `Reader`, `Consumer`) + `"Grant Access"` button.
- **Revoke Button:** `Revoke` button per user row with immediate revocation (< 60s Redis token blacklisting) and audit logging.
- **Privacy Isolation:** Readers cannot view fellow team members' identities.

---

### 3.11 Vault Export Modal (`components/export/ExportModal.tsx`)

#### 43. Dual-Mode Export Enforcement
- **Open Vault:** Workspace Owner can click `"Download Vault ZIP"`. Assembles all markdown notes, YAML front matter, and metadata into a standard `.zip` archive via `JSZip` and triggers browser download.
- **Locked Vault:** **Export is strictly prohibited**. Renders warning alert: *"Export is permanently disabled for Zero-Read Locked Vaults to prevent IP exfiltration."* Action button is completely disabled.

---

### 3.12 Obsidian & Markdown Importer Modal (`components/ingestion/ImporterModal.tsx`)

#### 44. Vault Ingestion
- **Location:** Workspace Actions -> `Import notes` (Open Vault Owner/Editor).
- **Behavior:** Accepts `.zip` archive of an Obsidian or Markdown vault. Parses YAML front matter, tags, and `[[wikilinks]]`, batch-inserts pages into PostgreSQL storage, and logs `publish_page` audit events.

---

### 3.13 AI Intelligence Suite Drawer (`features/notes-ai/NotesAiDrawer.tsx`)

#### 45. Notes AI Co-Pilot Capabilities
- **Location:** Slide-over drawer toggled via `"AI Co-Pilot"` button in editor.
- **Tabs:**
  - **Connect & Sorter:** Analyzes active note against vault context to suggest semantically relevant `[[links]]` and taxonomy `#tags` with 1-click application.
  - **Ask:** Grounded Q&A chatbot over note context with prompt chips and clickable wiki-link citations (`[[Note]]`).
  - **Transform Actions:** 1-click executive summary generation and note-to-locked-skill drafting.

---

## 4. Role-Based Access Control (RBAC) Interaction Matrix

| Workspace Action / Control | Owner | Editor | Reader | Consumer (Locked) |
| :--- | :---: | :---: | :---: | :---: |
| **Switch Vault Context** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Read Open Notes & Docs** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ Denied (Zero-Read) |
| **Create & Edit Notes** | ✅ Yes | ✅ Yes | ❌ Read-Only | ❌ Denied |
| **Delete Notes** | ✅ Yes | ✅ Yes | ❌ Read-Only | ❌ Denied |
| **Explore Knowledge Graph** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ Hidden |
| **View Activity & Audit** | ✅ Full Forensic | ✅ Vault Activity | ✅ Read Activity | ❌ Minimal |
| **Export Activity CSV** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Export Open Vault (ZIP)** | ✅ Audited | ❌ Denied | ❌ Denied | ❌ Denied |
| **Export Locked Vault** | 🚫 FORBIDDEN | 🚫 FORBIDDEN | 🚫 FORBIDDEN | 🚫 FORBIDDEN |
| **Manage Access & Sharing** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Import Notes / Vault** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Run Protected Skills** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Add Protected Skills** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Connect MCP Gateway** | ✅ Full Tools | ✅ Full Tools | ✅ Read Tools | ✅ Run Tools Only |

---

## 5. Keyboard Shortcuts & Accessibility Navigation Guide

The redesigned interface is engineered to satisfy **WCAG 2.2 Level AA**:
- **Focus Ring:** Consistent high-contrast 2px solid Electric Blue focus ring (`var(--focus-ring)` / `#0755E9`) with 2px offset.
- **Focus Containment:** All modal dialogs (`ImporterModal`, `ExportModal`, `SharingModal`, `McpConnectModal`) and the mobile navigation drawer contain keyboard focus (`Tab` / `Shift+Tab`) and restore focus upon dismissal.
- **Escape Dismissal:** All overlays, popovers, dropdowns, and drawers dismiss cleanly on `Escape`.
- **Keyboard Traversal:**
  - `Tab` / `Shift+Tab`: Traverse interactive elements in logical source order.
  - `ArrowUp` / `ArrowDown`: Navigate autocomplete suggestions in `WikiLinkPicker`.
  - `Enter`: Commit link selection, form submission, or activate focused button.
  - `Space`: Toggle buttons and checkboxes.
- **Reduced Motion:** Fully complies with `@media (prefers-reduced-motion: reduce)` by disabling non-essential transitions and animations.

---

## 6. Standard Operating Procedures & User Runbooks

### Runbook 1: Creating, Linking, and Publishing Notes
1. Switch to an **Open Vault** via the header Vault Selector.
2. In the navigation sidebar, click **`New note`** (or press `Enter` on the button).
3. Type the document title in the top header.
4. Draft content in the TipTap WYSIWYG editor. Format text using the toolbar or standard markdown shortcuts (`#` for headings, `-` for bullet lists).
5. To link another note, type `[[` anywhere in the body. The caret-anchored autocomplete popup appears. Use `ArrowUp`/`ArrowDown` and press `Enter` to insert the link.
6. Click the **Note Summary Pill** to open the Inspector drawer and add `#tags`, aliases, or adjust category.
7. Click **`Publish`** to commit an official immutable version snapshot to the timeline and audit ledger.

### Runbook 2: Converting an Open Note into a Protected Skill
1. Open the note containing the proprietary methodology or prompt instructions.
2. In the editor action bar, click **`More note actions`** (`...`) and select **`Create protected skill`**.
3. In `ConvertNoteToSkillModal`, review the extracted skill title, description, and parameter types (`string`, `number`, `boolean`).
4. Select the target **Locked Vault**.
5. Click **`Create Protected Skill`**. The content is encrypted with the target vault's unique AES-256-GCM key and published to the locked catalog with zero-read protection.

### Runbook 3: Connecting Claude or Cursor to the Vault MCP Gateway
1. In the header right, click **`Workspace actions`** and select **`Integrations`**.
2. Verify that the **MCP Gateway Status** shows green (`Connected`).
3. Select your preferred client tab:
   - For **Claude Desktop**: Click `"Copy configuration"` and paste into `claude_desktop_config.json`.
   - For **Cursor / Local Agent**: Copy the stdio execution command.
4. Restart your AI client. In Claude or Cursor, use `@tkxel-vault` to invoke retrieval tools (`search`, `get_page`, `get_context`) or execute locked skills (`run_skill`).

### Runbook 4: Auditing Security & Forensic Activity
1. Click the **`Activity & Audit`** tab in the header navigation.
2. Use the **Action** dropdown or search box to filter for sensitive actions (e.g., "Changed vault protection", "Blocked a tool request", "Exported open vault").
3. Click any event row to open the **Event Details drawer** and inspect the raw tamper-proof JSON payload, actor identity, and client IP.
4. To archive records for compliance, click **`Export CSV`** to download a timestamped RFC 4180 audit spreadsheet.
