/**
 * Link Graph and Relationship Definitions
 * Authoritative reference: tkxel_vault_SRS.md (Section 3.2, Section 5.1, Section 6)
 */

export interface Link {
  id: string;
  from_page_id: string;
  to_page_id?: string | null;
  raw_target: string; // The literal [[target]] as written in markdown
  link_type?: string | null; // Optional typed relationship (e.g. works_at, decided_in)
  resolved: boolean;
  created_at: Date;
}

export interface LinkGraphNode {
  id: string;
  title: string;
  type: string;
  vault_id: string;
}

export interface LinkGraphEdge {
  from: string;
  to: string;
  type?: string | null;
}

export interface LinkGraph {
  nodes: LinkGraphNode[];
  edges: LinkGraphEdge[];
}
