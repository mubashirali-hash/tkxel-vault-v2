import { VaultRole, VaultMode } from '@tkxel-vault/types';

export interface UserVaultAccess {
  vaultId: string;
  mode: VaultMode;
  role: VaultRole;
}

export const OPEN_RETRIEVAL_TOOLS = ['search', 'get_page', 'get_links', 'get_context'];
export const OPEN_EDITOR_TOOLS = ['add_note'];
export const LOCKED_TOOLS = ['list_skills', 'run_skill', 'ask_vault'];

/**
 * Dynamic Tool Palette Policy Engine (FR-62 to FR-64, FR-68).
 * Dynamically computes the set of tools exposed to Claude based on caller's active permissions.
 */
export class ToolPalettePolicy {
  /**
   * Evaluates permissions across all vaults accessible by the user and computes the authorized tool palette.
   */
  public computeAuthorizedTools(vaultAccessList: UserVaultAccess[]): Set<string> {
    const authorized = new Set<string>();

    let hasOpenReader = false;
    let hasOpenEditor = false;
    let hasLockedConsumer = false;

    for (const access of vaultAccessList) {
      if (access.mode === 'open') {
        if (access.role === 'reader' || access.role === 'editor' || access.role === 'owner') {
          hasOpenReader = true;
        }
        if (access.role === 'editor' || access.role === 'owner') {
          hasOpenEditor = true;
        }
      } else if (access.mode === 'locked') {
        if (
          access.role === 'consumer' ||
          access.role === 'reader' ||
          access.role === 'editor' ||
          access.role === 'owner'
        ) {
          hasLockedConsumer = true;
        }
      }
    }

    // Open retrieval tools
    if (hasOpenReader) {
      OPEN_RETRIEVAL_TOOLS.forEach((tool) => authorized.add(tool));
    }

    // Open editor tools
    if (hasOpenEditor) {
      OPEN_EDITOR_TOOLS.forEach((tool) => authorized.add(tool));
    }

    // Locked vault tools
    if (hasLockedConsumer) {
      LOCKED_TOOLS.forEach((tool) => authorized.add(tool));
    }

    return authorized;
  }

  /**
   * Generic error masker (FR-68).
   * Suppresses details about unshared or non-existent vaults and skills.
   */
  public maskAccessDenial(resourceType: string): Error {
    return new Error(`Resource '${resourceType}' not found or access not allowed.`);
  }
}
