/**
 * Audit Event and Logging Definitions
 * Authoritative reference: tkxel_vault_SRS.md (Section 3.6, Section 3.9, Section 6)
 */

export type AuditAction =
  | 'create_vault'
  | 'edit_vault'
  | 'delete_vault'
  | 'mode_change'
  | 'share_vault'
  | 'revoke_vault'
  | 'export_open_vault'
  | 'export_locked_denied'
  | 'create_page'
  | 'edit_page'
  | 'publish_page'
  | 'unpublish_page'
  | 'delete_page'
  | 'upload_skill'
  | 'publish_skill'
  | 'delete_skill'
  | 'tool_call'
  | 'tool_denied'
  | 'security_alert';

export interface AuditEvent {
  id: string;
  actor_id: string; // User ID or system identity
  action: AuditAction;
  target_id: string; // ID of vault, page, skill, or user
  timestamp: Date;
  metadata: Record<string, unknown>;
}
