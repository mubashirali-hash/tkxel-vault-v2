# ADR-007: Headless WYSIWYG Markdown Editor Architecture

## Status
Accepted

## Context
tkxel Vault users range from non-technical business leaders to software architects. They require:
1. A rich, fluid Notion-like WYSIWYG editing experience (`FR-01`).
2. Clean, uncorrupted round-trip serialization between rich-text DOM state and standard CommonMark / GitHub Flavored Markdown (`FR-02`).
3. Clean retention and visual editing of YAML front matter at document head (`FR-05`).
4. Inline `[[wiki-link]]` popover autocompletion triggered on typing `[[` with <50ms response (`FR-03`).
5. Append-only chronological timeline section authoring (`FR-06`).
6. Zero proprietary file format lock-in.

## Decision
We select a **headless Markdown editor architecture** based on ProseMirror / Tiptap patterns:
1. The editor treats Markdown as the canonical storage format.
2. YAML front matter is parsed separately and displayed in a dedicated top metadata card (`type`, `tags`, `aliases`, `status`, `owner`).
3. Inline `[[` keypress triggers an accessible floating fuzzy search menu that matches existing vault pages and aliases.
4. Ghost links (references to uncreated pages) are highlighted with a distinct dashed badge with a 1-click modal to instantiate the page (`FR-11`).
5. Renaming a document triggers transactional wiki-link refactoring (`FR-12`) using the `MarkdownEngine.refactorLinks` routine developed in Epic 2.

## Consequences
- **Positive:** Pristine Markdown is guaranteed at rest, ensuring portable backup and zero formatting degradation.
- **Positive:** Accessible, high-speed autocompletion popovers for wiki-links and tags without document reloading.
- **Negative:** Requires custom synchronization between front matter metadata state and raw markdown serialization.
