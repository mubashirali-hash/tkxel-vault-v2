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
}

export interface SkillPackage {
  manifest: SkillManifest;
  toolSchema: SkillToolSchema;
  scripts: Map<string, string>; // filename -> code
  templates: Map<string, string>;
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

    return obj as SkillToolSchema;
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
