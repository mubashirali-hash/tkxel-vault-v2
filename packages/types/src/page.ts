/**
 * Page, Version, Timeline, and Chunk Domain Definitions
 * Authoritative reference: tkxel_vault_SRS.md (Section 3.1, Section 5.4, Section 6)
 */

export type PageType =
  | 'note'
  | 'person'
  | 'client'
  | 'project'
  | 'decision'
  | 'meeting'
  | 'skill'
  | 'other'
  | (string & {});

export type VersionStatus = 'draft' | 'published';

export interface Page {
  id: string;
  vault_id: string;
  type: PageType;
  title: string;
  folder?: string;
  aliases: string[];
  tags: string[];
  front_matter: Record<string, unknown>;
  current_version_id?: string | null;
  created_at: Date;
  updated_at?: Date;
}

export interface Version {
  id: string;
  page_id: string;
  number: number;
  status: VersionStatus;
  encrypted_blob: Buffer | Uint8Array;
  created_by: string;
  created_at: Date;
}

export interface TimelineEntry {
  id: string;
  page_id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  entry_text: string;
  created_by: string;
  created_at: Date;
}

export interface Chunk {
  id: string;
  page_id: string;
  version_id: string;
  position: number;
  encrypted_text: Buffer | Uint8Array;
  embedding?: number[]; // 1536-dimensional vector
  tsv_content?: string;
}
