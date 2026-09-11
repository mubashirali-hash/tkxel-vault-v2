/**
 * Skill Package and Parameter Schema Definitions
 * Authoritative reference: tkxel_vault_SRS.md (Section 3.4, Section 5.3, Section 6)
 */

export interface ToolInputParam {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  inputs: Record<string, ToolInputParam>;
}

export interface Skill {
  id: string;
  vault_id: string;
  name: string;
  description?: string;
  tool_schema: ToolSchema;
  current_version_id?: string | null;
  created_at: Date;
  updated_at?: Date;
}
