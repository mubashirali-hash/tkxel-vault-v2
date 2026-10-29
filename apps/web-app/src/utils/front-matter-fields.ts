import YAML from 'yaml';

/** Front matter keys that have their own controls in the editor and are stored in dedicated columns. */
export const RESERVED_FRONT_MATTER_KEYS = ['title', 'type', 'tags', 'aliases', 'folder', 'body'];

const MAX_YAML_CHARS = 16_000;

/** The user-defined part of a page's front matter (FR-05): everything except the reserved keys. */
export function extractCustomFields(frontMatter: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontMatter || {})) {
    if (!RESERVED_FRONT_MATTER_KEYS.includes(key)) custom[key] = value;
  }
  return custom;
}

export function customFieldsToYaml(fields: Record<string, unknown>): string {
  return Object.keys(fields).length === 0 ? '' : YAML.stringify(fields).trimEnd();
}

export type ParsedCustomFields =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parses the YAML a user typed for extra front matter fields. Only a plain key/value mapping is accepted,
 * and reserved keys are refused so they cannot drift from the dedicated controls.
 */
export function parseCustomFieldsYaml(text: string): ParsedCustomFields {
  if (!text.trim()) return { ok: true, fields: {} };
  if (text.length > MAX_YAML_CHARS) return { ok: false, error: 'Front matter is too long.' };

  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (err: any) {
    return { ok: false, error: `Not valid YAML: ${String(err?.message || err).split('\n')[0]}` };
  }
  if (parsed === null || parsed === undefined) return { ok: true, fields: {} };
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Front matter must be a list of "key: value" lines.' };
  }
  const reserved = Object.keys(parsed).filter((key) => RESERVED_FRONT_MATTER_KEYS.includes(key));
  if (reserved.length > 0) {
    return { ok: false, error: `Use the fields above for: ${reserved.join(', ')}.` };
  }
  return { ok: true, fields: parsed as Record<string, unknown> };
}
