import YAML from 'yaml';

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  author?: string;
  instructions: string; // Decrypted markdown body of SKILL.md
}

export interface SkillToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
    additionalProperties?: boolean;
  };
  execution?: {
    kind: 'helper';
    runtime: 'node' | 'python' | 'python3' | 'bash';
    entrypoint: string;
    arguments?: string[];
  };
}

export interface SkillPackage {
  manifest: SkillManifest;
  toolSchema: SkillToolSchema;
  scripts: Map<string, string>; // filename -> code
  templates: Map<string, string>;
}

export const ENCRYPTED_SKILL_PACKAGE_FORMAT = 'tkxel-skill-package/v1';

export interface EncryptedSkillPackageV1 {
  format: typeof ENCRYPTED_SKILL_PACKAGE_FORMAT;
  skillMd: string;
  toolJson: SkillToolSchema;
  files: Record<string, string>;
}

export interface ParsedSkillPayload {
  manifest: SkillManifest;
  toolSchema?: SkillToolSchema;
  helper?: {
    runtime: 'node' | 'python' | 'python3' | 'bash';
    source: string;
    arguments: string[];
  };
  packaged: boolean;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates Agent Skill packages and input parameter schemas (FR-32).
 */
export class SkillManifestValidator {
  private static readonly MAX_HELPER_SOURCE_BYTES = 1024 * 1024;
  private static readonly SAFE_PACKAGE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/;

  /**
   * Parses and validates raw SKILL.md content.
   */
  public parseSkillMd(rawContent: string): SkillManifest {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = rawContent.match(frontmatterRegex);

    if (!match) {
      throw new ValidationError("Invalid SKILL.md: Missing required YAML front matter delimited by '---'.");
    }

    let parsedYaml: Record<string, any>;
    try {
      parsedYaml = YAML.parse(match[1]) || {};
    } catch (e: any) {
      throw new ValidationError(`Invalid YAML front matter in SKILL.md: ${e?.message}`);
    }

    if (!parsedYaml.name || typeof parsedYaml.name !== 'string') {
      throw new ValidationError("Invalid SKILL.md: 'name' field is required in YAML front matter.");
    }

    if (!parsedYaml.description || typeof parsedYaml.description !== 'string') {
      throw new ValidationError("Invalid SKILL.md: 'description' field is required in YAML front matter.");
    }

    return {
      name: parsedYaml.name.trim(),
      description: parsedYaml.description.trim(),
      version: parsedYaml.version,
      author: parsedYaml.author,
      instructions: match[2].trim(),
    };
  }

  /**
   * Validates tool.json definition.
   */
  public validateToolSchema(schema: unknown): SkillToolSchema {
    if (!schema || typeof schema !== 'object') {
      throw new ValidationError('Invalid tool.json: Must be a valid JSON object.');
    }

    const obj = schema as Record<string, any>;

    if (!obj.name || typeof obj.name !== 'string') {
      throw new ValidationError("Invalid tool.json: 'name' is required and must be a string.");
    }

    if (!obj.description || typeof obj.description !== 'string') {
      throw new ValidationError("Invalid tool.json: 'description' is required and must be a string.");
    }

    if (!obj.inputSchema || obj.inputSchema.type !== 'object' || !obj.inputSchema.properties) {
      throw new ValidationError("Invalid tool.json: 'inputSchema' must be of type 'object' with a 'properties' map.");
    }

    if (obj.execution !== undefined) {
      if (!obj.execution || typeof obj.execution !== 'object' || obj.execution.kind !== 'helper') {
        throw new ValidationError("Invalid tool.json: 'execution.kind' must be 'helper'.");
      }
      if (!['node', 'python', 'python3', 'bash'].includes(obj.execution.runtime)) {
        throw new ValidationError('Invalid tool.json: helper runtime is not supported.');
      }
      if (
        typeof obj.execution.entrypoint !== 'string' ||
        !SkillManifestValidator.SAFE_PACKAGE_PATH.test(obj.execution.entrypoint)
      ) {
        throw new ValidationError('Invalid tool.json: helper entrypoint must be a safe package-relative path.');
      }
      if (
        obj.execution.arguments !== undefined &&
        (!Array.isArray(obj.execution.arguments) ||
          obj.execution.arguments.length > 16 ||
          obj.execution.arguments.some(
            (arg: unknown) => typeof arg !== 'string' || arg.length > 256 || arg.includes('\0')
          ))
      ) {
        throw new ValidationError('Invalid tool.json: helper arguments must be at most 16 short strings.');
      }
    }

    return obj as SkillToolSchema;
  }

  /**
   * Parses the plaintext obtained from an encrypted skill blob. Prompt-only legacy
   * SKILL.md payloads remain supported. Executable helpers must use the versioned
   * package envelope so their entrypoint and source are validated together.
   */
  public parseEncryptedPayload(rawContent: string): ParsedSkillPayload {
    const trimmed = rawContent.trim();
    if (!trimmed.startsWith('{')) {
      return {
        manifest: this.parseSkillMd(rawContent),
        packaged: false,
      };
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      throw new ValidationError('Invalid encrypted skill package.');
    }

    if (!candidate || typeof candidate !== 'object') {
      throw new ValidationError('Invalid encrypted skill package.');
    }

    const pkg = candidate as Record<string, unknown>;
    if (pkg.format !== ENCRYPTED_SKILL_PACKAGE_FORMAT) {
      throw new ValidationError('Unsupported encrypted skill package format.');
    }
    if (typeof pkg.skillMd !== 'string' || !pkg.skillMd) {
      throw new ValidationError('Invalid encrypted skill package: SKILL.md is required.');
    }
    if (!pkg.files || typeof pkg.files !== 'object' || Array.isArray(pkg.files)) {
      throw new ValidationError('Invalid encrypted skill package: files map is required.');
    }

    const manifest = this.parseSkillMd(pkg.skillMd);
    const toolSchema = this.validateToolSchema(pkg.toolJson);
    if (this.normalizeName(manifest.name) !== this.normalizeName(toolSchema.name)) {
      throw new ValidationError('Encrypted skill package manifest and tool schema names do not match.');
    }

    const files = pkg.files as Record<string, unknown>;
    for (const [filePath, source] of Object.entries(files)) {
      if (!SkillManifestValidator.SAFE_PACKAGE_PATH.test(filePath) || typeof source !== 'string') {
        throw new ValidationError('Invalid encrypted skill package file entry.');
      }
    }

    let helper: ParsedSkillPayload['helper'];
    if (toolSchema.execution) {
      const source = files[toolSchema.execution.entrypoint];
      if (typeof source !== 'string') {
        throw new ValidationError('Encrypted skill package helper entrypoint is missing.');
      }
      if (Buffer.byteLength(source, 'utf-8') > SkillManifestValidator.MAX_HELPER_SOURCE_BYTES) {
        throw new ValidationError('Encrypted skill package helper exceeds the size limit.');
      }
      helper = {
        runtime: toolSchema.execution.runtime,
        source,
        arguments: [...(toolSchema.execution.arguments || [])],
      };
    }

    return {
      manifest,
      toolSchema,
      helper,
      packaged: true,
    };
  }

  public normalizeName(value: string): string {
    return value.trim().toLowerCase().replace(/_/g, '-');
  }

  /**
   * Validates user arguments against tool inputSchema (FR-32).
   */
  public validateParameters(schema: SkillToolSchema['inputSchema'], args: Record<string, unknown>): void {
    const required = schema.required || [];
    for (const req of required) {
      if (args[req] === undefined || args[req] === null || args[req] === '') {
        throw new ValidationError(`Missing required parameter: '${req}'.`);
      }
    }

    if (schema.additionalProperties === false) {
      const allowedKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(args)) {
        if (!allowedKeys.has(key)) {
          throw new ValidationError(`Unexpected argument '${key}'. Additional properties are not allowed.`);
        }
      }
    }

    for (const [paramName, value] of Object.entries(args)) {
      const expectedProp = schema.properties[paramName];
      if (!expectedProp || value === undefined || value === null) continue;

      const valType = Array.isArray(value) ? 'array' : typeof value;
      if (expectedProp.type && valType !== expectedProp.type) {
        throw new ValidationError(
          `Invalid type for parameter '${paramName}': expected '${expectedProp.type}', received '${valType}'.`
        );
      }

      if (expectedProp.enum && Array.isArray(expectedProp.enum)) {
        if (!expectedProp.enum.includes(String(value))) {
          throw new ValidationError(
            `Invalid value for parameter '${paramName}': must be one of [${expectedProp.enum.join(', ')}].`
          );
        }
      }
    }
  }
}
