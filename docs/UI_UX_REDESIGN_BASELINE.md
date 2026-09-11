# tkxel Vault UI/UX Redesign Baseline

**Epic:** UXR-00

**Captured:** September 9, 2026

**Branch:** `codex/ui-ux-redesign`

**Rollback tag:** `ui-ux-redesign-baseline`

**Rollback commit:** `cb83b61`

## Purpose

This document records the verified application state immediately before the UI/UX redesign. It provides a stable comparison point and an easy recovery target if a redesign epic introduces unacceptable regressions.

## Verified baseline

- TypeScript checks pass across the workspace.
- The full pipeline passes 11 of 11 tasks.
- The web application passes its existing 13 tests.
- The production web build succeeds.
- The primary minified JavaScript bundle is approximately 1,129.91 kB, or 356.35 kB compressed.
- The existing build reports a warning because the main JavaScript chunk exceeds 500 kB. This is a baseline condition, not a redesign regression.

The machine-readable baseline is stored in [`ui-redesign-baseline.json`](file:///C:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/apps/web-app/test/fixtures/ui-redesign-baseline.json).

## Required viewport matrix

| Target | Viewport |
| :--- | :--- |
| Mobile | 390×844 |
| Tablet | 768×1024 |
| Compact laptop | 1024×768 |
| Standard desktop | 1280×720 |
| Wide desktop | 1440×900 |

## Required surface matrix

Each relevant redesign epic must verify:

1. Open Vault — Notes and editor.
2. Open Vault — Knowledge Graph.
3. Open Vault — Activity and Audit.
4. Locked Vault — Skills catalog.
5. Locked Vault — Activity and Audit.

## Protected regression contracts

- Locked Vaults do not expose the Open Vault graph.
- Locked Vaults cannot be exported by any role.
- Open Vault exports remain owner-only.
- Markdown, YAML front matter, tags, aliases, and wiki-links retain round-trip fidelity.
- The two-hop local graph remains available for Open Vault notes.
- Timeline entries remain append-only.
- State-changing operations remain audited.

Automated source-contract coverage is stored in [`ui-redesign-baseline.test.js`](file:///C:/Users/mubashir.ali/Desktop/tkxel_vault_SRS/apps/web-app/test/ui-redesign-baseline.test.js). Existing behavioral and security suites remain authoritative and must continue to pass.

## Known baseline UX problems

- The fixed-width sidebar makes the mobile editor unusable.
- Header actions clip at compact laptop widths.
- Management and integration actions appear in multiple persistent locations.
- Editor actions lack a clear primary/secondary hierarchy.
- Locked skills are duplicated in the sidebar and main catalog.
- Graph nodes and relationships are difficult to interpret quickly.
- Audit rows prioritize identifiers and raw JSON over readable activity.
- Responsive rules and accessible labels are incomplete.

These are accepted baseline findings and are addressed by UXR-01 through UXR-08. Tests must not normalize these deficiencies as desired behavior.

## Rollback procedure

The safest review-time rollback is to inspect or restore an individual epic commit. If the entire redesign must be abandoned, the named baseline can be restored with Git using the `ui-ux-redesign-baseline` tag.

Do not run a destructive reset while uncommitted work exists. First preserve any new work in a commit or separate branch. The baseline tag is immutable unless an administrator intentionally moves or deletes it.

## Review rule

Every redesign epic ends with:

1. Type checking.
2. Applicable focused tests.
3. The full test pipeline.
4. Production build verification.
5. Visual checks at applicable target viewports.
6. A dedicated commit and product review gate.
