import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { createKmsProvider, EnvelopeEncryption } from '@tkxel-vault/vault-core/crypto';
import { getSkillStatus, SkillStatus } from '@tkxel-vault/vault-core';
import {
  SkillManifestValidator,
  ValidationError,
  ENCRYPTED_SKILL_PACKAGE_FORMAT,
  SkillToolSchema,
} from '@tkxel-vault/skill-runner';
import { and, eq } from 'drizzle-orm';
import { scanSkillPackage, ScanFinding } from './skill-scanner.js';

/** Raised for any rejected skill upload; the message is safe to return to the uploader. */
export class SkillValidationError extends Error {
  /** Present when the upload was rejected by the security scan (NFR-07). */
  public readonly findings?: ScanFinding[];
  constructor(message: string, findings?: ScanFinding[]) {
    super(message);
    this.name = 'SkillValidationError';
    this.findings = findings;
  }
}

export interface SkillUploadInput {
  /** Raw SKILL.md including YAML front matter. When omitted it is assembled from the fields below. */
  skill_md?: string;
  name?: string;
  description?: string;
  version?: string;
  runtime?: string;
  timeout_seconds?: number;
  system_instructions?: string;
  /** tool.json as an object or JSON text. Accepts the SRS 5.3 `inputs` map or a JSON-Schema `inputSchema`. */
  tool_json?: unknown;
  tool_schema?: unknown;
  /** Companion files (helper scripts, templates) keyed by package-relative path. */
  files?: Record<string, string>;
}

export interface StoredSkillSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: string;
  timeout_seconds: number;
  status: SkillStatus;
  tool_schema: SkillToolSchema['inputSchema'];
  created_at: string;
  updated_at: string;
}

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 64;
const ALLOWED_INPUT_TYPES = new Set(['string', 'number', 'boolean', 'array', 'object']);
const MAX_EXECUTION_TIMEOUT_SECONDS = 120; // FR-74

const validator = new SkillManifestValidator();

function parseJsonMaybe(value: unknown, label: string): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new SkillValidationError(`${label} is not valid JSON.`);
  }
}

function buildSkillMd(input: SkillUploadInput): string {
  if (typeof input.skill_md === 'string' && input.skill_md.trim()) {
    return input.skill_md;
  }
  if (!input.name || !input.description) {
    throw new SkillValidationError("SKILL.md is required, with 'name' and 'description' in its YAML front matter.");
  }
  // JSON string literals are valid YAML scalars, which keeps arbitrary text safe in front matter
  const frontMatter = [
    `name: ${JSON.stringify(String(input.name).trim())}`,
    `description: ${JSON.stringify(String(input.description).trim())}`,
    ...(input.version ? [`version: ${JSON.stringify(String(input.version))}`] : []),
  ].join('\n');
  return `---\n${frontMatter}\n---\n${input.system_instructions || ''}`;
}

/**
 * Normalizes an uploaded tool.json into the strict schema the runner enforces (FR-32).
 * Returns null when no input contract was declared at all.
 */
function normalizeToolJson(raw: unknown, manifestName: string, manifestDescription: string): SkillToolSchema | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new SkillValidationError('tool.json must be a JSON object.');
  }
  const doc = raw as Record<string, any>;

  let properties: Record<string, any> | undefined;
  let required: string[] = [];

  if (doc.inputs && typeof doc.inputs === 'object' && !Array.isArray(doc.inputs)) {
    // SRS 5.3 form: { inputs: { client: { type, required, description } } }
    properties = {};
    for (const [key, spec] of Object.entries(doc.inputs as Record<string, any>)) {
      if (!spec || typeof spec !== 'object') {
        throw new SkillValidationError(`tool.json input '${key}' must be an object.`);
      }
      const { required: isRequired, ...rest } = spec as Record<string, any>;
      properties[key] = rest;
      if (isRequired === true) required.push(key);
    }
  } else {
    const inputSchema = doc.inputSchema ?? (doc.type === 'object' || doc.properties ? doc : undefined);
    if (inputSchema && typeof inputSchema === 'object') {
      if (inputSchema.type !== undefined && inputSchema.type !== 'object') {
        throw new SkillValidationError("tool.json 'inputSchema.type' must be 'object'.");
      }
      properties = inputSchema.properties && typeof inputSchema.properties === 'object' ? { ...inputSchema.properties } : undefined;
      required = Array.isArray(inputSchema.required) ? [...inputSchema.required] : [];
    }
  }

  if (!properties) return null;

  for (const [key, spec] of Object.entries(properties)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
      throw new SkillValidationError(`tool.json input name '${key}' is not a valid identifier.`);
    }
    if (!spec || typeof spec !== 'object') {
      throw new SkillValidationError(`tool.json input '${key}' must be an object.`);
    }
    const type = spec.type === 'integer' ? 'number' : spec.type;
    if (!ALLOWED_INPUT_TYPES.has(type)) {
      throw new SkillValidationError(`tool.json input '${key}' has unsupported type '${String(spec.type)}'.`);
    }
    properties[key] = { ...spec, type };
  }
  for (const key of required) {
    if (typeof key !== 'string' || !(key in properties)) {
      throw new SkillValidationError(`tool.json marks '${String(key)}' as required but does not declare it.`);
    }
  }

  return {
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : manifestName,
    description: typeof doc.description === 'string' && doc.description.trim() ? doc.description.trim() : manifestDescription,
    inputSchema: {
      type: 'object',
      properties,
      required,
      // Strict by construction: undeclared arguments are always rejected at run time
      additionalProperties: false,
    },
    ...(doc.execution !== undefined ? { execution: doc.execution } : {}),
  };
}

function toSummary(row: typeof schema.skills.$inferSelect): StoredSkillSummary {
  const doc = (row.tool_schema as Record<string, any>) || {};
  return {
    id: row.id,
    name: row.name,
    version: doc.version || 'v1.0',
    description: doc.description || '',
    runtime: doc.runtime || 'Prompt only',
    timeout_seconds: doc.timeout_seconds || MAX_EXECUTION_TIMEOUT_SECONDS,
    status: getSkillStatus(doc),
    tool_schema: doc.tool_schema || { type: 'object', properties: {} },
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function loadVault(vaultId: string) {
  const rows = await db.select().from(schema.vaults).where(eq(schema.vaults.id, vaultId)).limit(1);
  if (!rows[0] || !rows[0].data_key_id) {
    throw new Error('not_found');
  }
  return rows[0];
}

/**
 * Validates, encrypts and stores a skill (FR-30, FR-32, NFR-01).
 * Nothing is written unless SKILL.md, tool.json and every companion file pass validation.
 * Uploading a name that already exists in the vault replaces that skill.
 */
export async function upsertSkill(params: {
  vaultId: string;
  actorId: string;
  status: SkillStatus;
  input: SkillUploadInput;
}): Promise<{ skill: StoredSkillSummary; created: boolean }> {
  const { vaultId, actorId, status, input } = params;
  if (!input || typeof input !== 'object') {
    throw new SkillValidationError('Skill upload body must be a JSON object.');
  }

  const vault = await loadVault(vaultId);

  let manifest;
  let toolJson: SkillToolSchema | null;
  let packageJson: string;
  let scanReport: ReturnType<typeof scanSkillPackage>;
  const skillMd = buildSkillMd(input);

  try {
    manifest = validator.parseSkillMd(skillMd);
    if (!manifest.instructions) {
      throw new SkillValidationError('SKILL.md must contain instructions below its front matter.');
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,99}$/.test(manifest.name)) {
      throw new SkillValidationError('Skill name may only contain letters, digits, spaces, hyphens and underscores.');
    }

    toolJson = normalizeToolJson(
      parseJsonMaybe(input.tool_json ?? input.tool_schema, 'tool.json'),
      manifest.name,
      manifest.description
    );
    if (!toolJson && vault.mode === 'locked') {
      throw new SkillValidationError(
        'Locked-vault skills must declare their inputs in tool.json (use "inputs": {} for a skill that takes none).'
      );
    }

    const files = input.files ?? {};
    if (typeof files !== 'object' || Array.isArray(files)) {
      throw new SkillValidationError('files must be a map of package-relative path to text content.');
    }
    if (Object.keys(files).length > MAX_FILES) {
      throw new SkillValidationError(`A skill package may contain at most ${MAX_FILES} companion files.`);
    }

    // Prompt-only skills without a declared contract (open vaults) keep the plain SKILL.md payload.
    packageJson = toolJson
      ? JSON.stringify({ format: ENCRYPTED_SKILL_PACKAGE_FORMAT, skillMd, toolJson, files })
      : skillMd;

    if (Buffer.byteLength(packageJson, 'utf-8') > MAX_PACKAGE_BYTES) {
      throw new SkillValidationError('Skill package exceeds the 2 MB size limit.');
    }

    // Final gate: the exact bytes that will be encrypted must be loadable by the runner
    validator.parseEncryptedPayload(packageJson);

    // Security scan before anything is stored or published (NFR-07)
    scanReport = scanSkillPackage({ skillMd, toolJson, files: files as Record<string, string> });
    if (!scanReport.passed) {
      throw new SkillValidationError(
        'Skill rejected by the security scan.',
        scanReport.findings.filter((f) => f.severity === 'block')
      );
    }
  } catch (err) {
    if (err instanceof ValidationError) {
      throw new SkillValidationError(err.message);
    }
    throw err;
  }

  const timeoutSeconds = Math.min(
    Math.max(Number(input.timeout_seconds) || MAX_EXECUTION_TIMEOUT_SECONDS, 1),
    MAX_EXECUTION_TIMEOUT_SECONDS
  );

  const kms = createKmsProvider();
  const dek = await kms.unwrapKey(vault.data_key_id);
  let encryptedPayload: string;
  try {
    encryptedPayload = EnvelopeEncryption.encrypt(packageJson, dek).toString('base64');
  } finally {
    dek.fill(0);
  }

  // Only metadata needed for discovery is stored in the clear; instructions and files live in the ciphertext
  const document = {
    description: manifest.description,
    version: manifest.version ? String(manifest.version) : input.version || 'v1.0',
    runtime: toolJson?.execution ? `${toolJson.execution.runtime} (sandboxed helper)` : 'Prompt only',
    timeout_seconds: timeoutSeconds,
    status,
    // Locked vaults only run skills that declared their inputs (FR-32)
    contract_declared: Boolean(toolJson),
    // Outcome of the pre-storage security scan; warnings are kept for Owner review
    scan: {
      status: 'passed',
      scanned_files: scanReport.scanned_files,
      warnings: scanReport.findings.map((f) => ({ rule: f.rule, file: f.file, line: f.line, message: f.message })),
      scanned_at: new Date().toISOString(),
    },
    encrypted_payload: encryptedPayload,
    tool_schema: toolJson?.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
  };

  return await db.transaction(async (tx) => {
    const existing = await tx.select().from(schema.skills).where(eq(schema.skills.vault_id, vaultId)).for('update');
    const normalized = validator.normalizeName(manifest.name);
    const match = existing.find((s) => validator.normalizeName(s.name) === normalized);

    let row: typeof schema.skills.$inferSelect;
    if (match) {
      [row] = await tx.update(schema.skills)
        .set({ name: manifest.name, tool_schema: document, updated_at: new Date() })
        .where(and(eq(schema.skills.id, match.id), eq(schema.skills.vault_id, vaultId)))
        .returning();
    } else {
      [row] = await tx.insert(schema.skills)
        .values({ vault_id: vaultId, name: manifest.name, tool_schema: document })
        .returning();
    }

    await tx.insert(schema.auditEvents).values({
      actor_id: actorId,
      action: 'upload_skill',
      target_id: row.id,
      metadata: {
        vault_id: vaultId,
        status,
        replaced: Boolean(match),
        package_bytes: Buffer.byteLength(packageJson, 'utf-8'),
        scan_warnings: scanReport.findings.length,
      },
    });

    return { skill: toSummary(row), created: !match };
  });
}

/** Marks a stored skill as published (Owners only; enforced by the route). */
export async function publishSkill(params: { vaultId: string; skillId: string; actorId: string }): Promise<StoredSkillSummary | null> {
  return await db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.skills)
      .where(and(eq(schema.skills.id, params.skillId), eq(schema.skills.vault_id, params.vaultId)))
      .for('update');
    if (!rows[0]) return null;

    const document = { ...((rows[0].tool_schema as Record<string, any>) || {}), status: 'published' };
    const [row] = await tx.update(schema.skills)
      .set({ tool_schema: document, updated_at: new Date() })
      .where(eq(schema.skills.id, rows[0].id))
      .returning();

    await tx.insert(schema.auditEvents).values({
      actor_id: params.actorId,
      action: 'publish_skill',
      target_id: row.id,
      metadata: { vault_id: params.vaultId },
    });
    return toSummary(row);
  });
}

export async function deleteSkill(params: { vaultId: string; skillId: string; actorId: string }): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const deleted = await tx.delete(schema.skills)
      .where(and(eq(schema.skills.id, params.skillId), eq(schema.skills.vault_id, params.vaultId)))
      .returning({ id: schema.skills.id });
    if (deleted.length === 0) return false;

    await tx.insert(schema.auditEvents).values({
      actor_id: params.actorId,
      action: 'delete_skill',
      target_id: params.skillId,
      metadata: { vault_id: params.vaultId },
    });
    return true;
  });
}

export async function listSkills(vaultId: string): Promise<Array<{ row: typeof schema.skills.$inferSelect; summary: StoredSkillSummary }>> {
  const rows = await db.select().from(schema.skills).where(eq(schema.skills.vault_id, vaultId));
  return rows.map((row) => ({ row, summary: toSummary(row) }));
}

/**
 * Decrypts a stored skill for an authorized administrative reader (FR-31). The caller is responsible
 * for the role check; every read is audited.
 */
export async function readSkillSource(params: { vaultId: string; skillId: string; actorId: string }): Promise<{
  skill_md: string;
  system_instructions: string;
  tool_json: SkillToolSchema | null;
  files: Record<string, string>;
} | null> {
  const rows = await db.select().from(schema.skills)
    .where(and(eq(schema.skills.id, params.skillId), eq(schema.skills.vault_id, params.vaultId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const document = (row.tool_schema as Record<string, any>) || {};
  if (typeof document.encrypted_payload !== 'string') {
    return null;
  }

  const vault = await loadVault(params.vaultId);
  const kms = createKmsProvider();
  const dek = await kms.unwrapKey(vault.data_key_id);
  let plaintext: string;
  try {
    plaintext = EnvelopeEncryption.decryptToString(Buffer.from(document.encrypted_payload, 'base64'), dek);
  } finally {
    dek.fill(0);
  }

  const packaged = plaintext.trim().startsWith('{');
  const pkg = packaged ? (JSON.parse(plaintext) as Record<string, any>) : null;
  const skillMd: string = pkg ? pkg.skillMd : plaintext;

  await db.insert(schema.auditEvents).values({
    actor_id: params.actorId,
    action: 'view_skill_source',
    target_id: row.id,
    metadata: { vault_id: params.vaultId },
  });

  return {
    skill_md: skillMd,
    system_instructions: validator.parseSkillMd(skillMd).instructions,
    tool_json: pkg ? (pkg.toolJson as SkillToolSchema) : null,
    files: pkg ? (pkg.files as Record<string, string>) : {},
  };
}
