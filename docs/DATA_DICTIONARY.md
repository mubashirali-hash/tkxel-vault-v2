# tkxel Vault Data Dictionary and Storage Boundaries

**Status:** release-reconciliation inventory, 2026-09-21. This document describes the current schema; it is not an approval to store plaintext content.

## Classification rules

- **Ciphertext** is AES-256-GCM-protected content encrypted with the owning vault's DEK.
- **Structural metadata** is needed for authorization, routing, graph relationships, or user-visible labels. It is not a page body, but must still be access-controlled through server authorization and PostgreSQL RLS.
- **Derived indexes** are permitted only for open vaults under [ADR-017](./adr/ADR-017-searchable-encryption-boundaries.md). They have documented leakage characteristics and are prohibited for locked vaults.
- **Plaintext content** is not acceptable for production persistence. Any identified field is a release blocker until migrated or removed.

## Tables

| Table | Ciphertext fields | Structural metadata / derived data | Retention and boundary |
| --- | --- | --- | --- |
| `vaults` | `data_key_id` holds the KMS-wrapped per-vault DEK, not a raw key. | ID, name, mode, owner, export policy, timestamps. | Active vault record; deleted with its lifecycle. Raw DEKs are never stored. |
| `pages` | None. Page body is not stored here. | ID, vault ID, type, title, aliases, tags, front matter, current version ID, timestamps. `front_matter` must not contain a body. | Cascades with vault deletion. These labels are access-controlled metadata. |
| `versions` | `encrypted_blob` contains the serialized page-version body. | ID, page ID, version number/status, author, timestamp. | Version history is retained while its page exists; cascades when the page is deleted. |
| `chunks` | `encrypted_text` holds an open-vault chunk. | Position; open vault only: `tsv_content` and 1536-dimensional `embedding`. | Replaced atomically during publish and cascades with the version/page. Locked vaults must have zero rows, tsvectors, and embeddings. |
| `links` | None. | From/to IDs, raw wiki-link target, link type, resolution flag, timestamp. | Cascades with source page. Cross-vault targets are unresolved ghost links under ADR-018. |
| `skills` | The executable package/version content is held in the encrypted version/artifact path, never in `tool_schema`. | ID, vault ID, display name, tool schema, current version ID, timestamps. | Cascades with vault deletion. Locked-tool metadata is filtered by server authorization. |
| `shares` | None. | Vault/principal IDs, role, grant and revoke data. | Revoked entries are retained as authorization history unless a lawful retention policy changes it. |
| `audit_events` | None. | Actor, action, target, timestamp, sanitized metadata. | Append-only: database triggers reject updates and deletes. Metadata must never contain secrets, DEKs, prompts, or page bodies. |
| `timeline_entries` | **None — release blocker.** | Page ID, date, creator, timestamp; `entry_text` is currently an ordinary `text` column. | Cascades with its page. New production deployments must not treat this field as compliant content storage; it needs an encrypted replacement and migration before production approval. |

## Browser and operational storage

- Browser storage must never retain decrypted page bodies, locked-vault metadata, prompts, skill source, or persistent bearer tokens. Open-vault cached sidebar data is restricted to structural metadata.
- Redis contains short-lived revocation, rate-limit, and service-token replay data. It is operational state, not content storage.
- Database base backups have a 30-day operational retention target and WAL supports point-in-time recovery; this does not override an application's legal retention policy.
- Application tables do not currently implement a universal time-based deletion policy. Product/legal owners must define one before production launch.

## Required remediation before production sign-off

1. Replace or encrypt `timeline_entries.entry_text`, migrate existing values safely, and extend the storage canary to cover it.
2. Attach evidence from genuine cloud KMS and hosted LLM providers. Contract-test doubles remain useful regression coverage but are not production evidence.

