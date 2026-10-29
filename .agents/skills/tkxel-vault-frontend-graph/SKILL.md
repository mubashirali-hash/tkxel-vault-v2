---
name: tkxel-vault-frontend-graph
description: >-
  Build, customize, and maintain the tkxel Vault Admin Web App, focusing on the
  headless WYSIWYG markdown editor (Tiptap/Milkdown), [[link]] autocompletion,
  backlinks panel, and the interactive 2D force-directed knowledge graph (D3.js/Cytoscape).
  Use whenever working on UI components, graph rendering, or client-side markdown handling.
---

# tkxel Vault: Frontend & Visual Graph Skill

This skill guides the implementation of the **Vault Admin Web Application** as defined in the [SRS](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_SRS.md) ([FR-01 to FR-16]) and [PRD](file:///c:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/tkxel_vault_PRD.md).

## Core Responsibilities

1. **WYSIWYG Markdown Editor (`FR-01` to `FR-09`)**:
   - Integrate a headless rich-text editor (recommended: **Tiptap** or **Milkdown**) supporting standard CommonMark, GFM tables, task lists, code blocks, and callouts.
   - Parse and serialize YAML front matter at the top of documents (`title`, `type`, `tags`, `owner`, `status`).
   - Implement slash commands (`/heading`, `/table`, `/callout`, `/timeline`).
   - Support the append-only timeline section (`FR-06`).

2. **Wiki-Link Autocompletion & Cascade Renaming (`FR-03`, `FR-10` to `FR-12`)**:
   - Inline trigger on typing `[[`: Fetch fuzzy autocomplete results for page titles and aliases.
   - Highlight unresolved / ghost links with distinct styling; provide a 1-click modal to instantiate new pages (`FR-11`).
   - Cascade page renames across all outgoing references in the vault (`FR-12`).

3. **Interactive Knowledge Graph (`FR-13` to `FR-14`, `NFR-11`)**:
   - Render force-directed 2D graphs using **D3.js** or **Cytoscape.js**.
   - Performance benchmark: Render 2,000+ nodes under 3 seconds on standard browsers (`NFR-11`).
   - Visual styling: Color-code nodes by page type (`client`, `person`, `project`, `decision`, `meeting`, `skill`).
   - Interactive features: Node hovering, search filtering by tag/type, click-to-open page.
   - Implement the **Local Neighborhood Graph** (`FR-14`): 2-hop radius centered around the active page.

4. **Multi-Format Ingestion UI (`FR-07`)**:
   - Drag-and-drop ingestion interface supporting raw `.md` files, `.zip` archives, and full **Obsidian vault exports**.

## Architecture & Component Structure

```
src/
├── components/
│   ├── editor/
│   │   ├── MarkdownEditor.tsx       # Tiptap / Milkdown instance
│   │   ├── FrontMatterEditor.tsx    # YAML metadata panel
│   │   ├── WikiLinkExtension.ts     # TipTap [[...]] extension
│   │   └── TimelineSection.tsx      # Append-only timeline UI
│   ├── graph/
│   │   ├── ForceGraphView.tsx       # Full vault 2D D3/Cytoscape graph
│   │   ├── LocalGraphView.tsx       # 2-hop focused neighborhood graph
│   │   └── GraphFilterToolbar.tsx   # Filter by type, tag, vault
│   └── navigation/
│       ├── BacklinkPanel.tsx        # Inbound and outbound link list
│       └── VaultSidebar.tsx         # Vault hierarchy & status badges
```

## Step-by-Step Implementation Workflow

1. **Editor Setup**:
   - Configure Tiptap with `@tiptap/starter-kit`, `@tiptap/extension-table`, and custom `WikiLink` mark.
   - Bind `[[` keypress event to the search dropdown popover.
2. **Backlink & Local Graph Synchronization**:
   - Whenever an active document changes, query `/api/vaults/{id}/pages/{pageId}/links` to populate the `BacklinkPanel` and `LocalGraphView`.
3. **Graph Optimization**:
   - Use HTML5 Canvas or WebGL rendering mode in D3/Cytoscape to handle 2,000+ nodes smoothly.
   - Debounce graph layout physics calculations to avoid UI jank.
