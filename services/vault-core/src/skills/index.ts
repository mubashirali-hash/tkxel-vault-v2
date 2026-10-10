/**
 * Skill publication state. Stored inside the skill row's tool_schema document.
 * Rows written before the state existed carry no status and are treated as published.
 */
export type SkillStatus = 'draft' | 'published';

export function getSkillStatus(toolSchema: unknown): SkillStatus {
  const status = (toolSchema as { status?: unknown } | null | undefined)?.status;
  return status === 'draft' ? 'draft' : 'published';
}

/** Consumers, `list_skills`, `run_skill` and `ask_vault` only ever see published skills (FR-41, FR-43). */
export function isSkillPublished(skill: { tool_schema: unknown }): boolean {
  return getSkillStatus(skill.tool_schema) === 'published';
}
