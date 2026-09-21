import { McpToolDefinition, ToolCallContext, ToolCallResult } from '../transport/streamable-http.js';
import { db } from '@tkxel-vault/vault-core/db';
import * as schema from '@tkxel-vault/vault-core/schema';
import { eq, and } from 'drizzle-orm';
import { createServiceToken } from '@tkxel-vault/skill-runner';


export const LIST_SKILLS_TOOL: McpToolDefinition = {
  name: 'list_skills',
  description:
    'Discover and list all proprietary AI skills available in accessible locked vaults. Returns each skill name, description, parameters, and its locked vaultId so callers know exactly which vault to target.',
  inputSchema: {
    type: 'object',
    properties: {
      vaultId: {
        type: 'string',
        description: 'The authorized locked vault ID whose skill catalog should be listed.',
      },
      vault_id: {
        type: 'string',
        description: 'Alias for vaultId.',
      },
    },
    required: ['vaultId'],
  },
};

export const RUN_SKILL_TOOL: McpToolDefinition = {
  name: 'run_skill',
  description:
    'Execute a predefined AI skill inside an explicitly identified authorized locked vault without exposing raw source content.',
  inputSchema: {
    type: 'object',
    properties: {
      skillName: {
        type: 'string',
        description: 'The name of the skill to execute (e.g., "executive-briefing-agent", "cloud-cost-optimizer").',
      },
      vaultId: {
        type: 'string',
        description: 'The ID of the authorized locked vault.',
      },
      parameters: {
        type: 'object',
        description: 'Any parameters required by the skill.',
        additionalProperties: true,
      },
    },
    required: ['skillName', 'vaultId'],
  },
};

export const ASK_VAULT_TOOL: McpToolDefinition = {
  name: 'ask_vault',
  description:
    'Ask a high-level question about an explicitly identified authorized locked vault without exposing raw markdown.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The question to ask the locked vault.',
      },
      vaultId: {
        type: 'string',
        description: 'The ID of the authorized locked vault.',
      },
    },
    required: ['query', 'vaultId'],
  },
};

const FORBIDDEN_PATTERNS = [
  /system\s*prompt/gi,
  /SKILL\.md/gi,
  /tool\.json/gi,
  /\/vaults\/[a-zA-Z0-9_\-\/]+/gi,
  /AES-256-GCM/gi,
  /data_key_id/gi,
  /dek\s*key/gi,
];

function sanitizeOutput(output: string, secretInstructions?: string): string {
  let text = output;
  if (secretInstructions && secretInstructions.length > 20) {
    const chunkSize = 25;
    for (let i = 0; i <= secretInstructions.length - chunkSize; i += 15) {
      const chunk = secretInstructions.slice(i, i + chunkSize).trim();
      if (chunk.length >= 15 && text.includes(chunk)) {
        text = text.replaceAll(chunk, '[Internal instruction excerpt redacted by tkxel Vault anti-exfiltration filter]');
      }
    }
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    text = text.replace(pattern, '[Internal system reference redacted]');
  }
  return text;
}



const LOCKED_TOOL_ROLES = new Set(['owner', 'editor', 'consumer']);

function requireAuthorizedLockedVault(
  args: Record<string, unknown> | undefined,
  context: ToolCallContext | undefined,
): { vaultId: string; role: string } {
  const rawVaultId = args?.vaultId ?? args?.vault_id;
  const vaultId = typeof rawVaultId === 'string' ? rawVaultId.trim() : '';
  const role = vaultId ? context?.roles.get(vaultId) : undefined;
  const mode = vaultId ? context?.vaultModes?.get(vaultId) : undefined;

  if (!vaultId || mode !== 'locked' || !role || !LOCKED_TOOL_ROLES.has(role)) {
    throw new Error('not_allowed');
  }

  return { vaultId, role };
}

export function createLockedRetrievalHandlers() {
  return {
    handleListSkills: async (args: any, context: ToolCallContext): Promise<ToolCallResult> => {
      const { vaultId } = requireAuthorizedLockedVault(args, context);

      try {
        const lockedVaults = await db
          .select()
          .from(schema.vaults)
          .where(and(eq(schema.vaults.id, vaultId), eq(schema.vaults.mode, 'locked')));

        const authorizedVaults = lockedVaults;

        if (authorizedVaults.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No authorized locked vaults found or access not permitted.',
              },
            ],
          };
        }

        const allSkills = await db.select().from(schema.skills);

        const skillCatalog: Array<{
          vaultId: string;
          vaultName: string;
          skillName: string;
          description: string;
          runtime: string;
          exampleCall: string;
        }> = [];

        for (const vault of authorizedVaults) {
          const matchingSkills = allSkills.filter((s) => s.vault_id === vault.id);
          for (const sk of matchingSkills) {
            const toolSchema = (sk.tool_schema as any) || {};
            skillCatalog.push({
              vaultId: vault.id,
              vaultName: vault.name,
              skillName: sk.name,
              description: toolSchema.description || `Proprietary skill: ${sk.name}`,
              runtime: toolSchema.runtime || 'Python 3.12 Sandboxed',
              exampleCall: `run_skill("${sk.name}", vaultId: "${vault.id}")`,
            });
          }
        }

        let markdown = `# Authorized Locked Vault Skills Catalog\n\n`;
        markdown += `Use \`run_skill(skillName: "...", vaultId: "...")\` to execute any of the following skills:\n\n`;
        markdown += `| Vault Name | Vault ID | Skill Name | Description | Example Call |\n`;
        markdown += `|:---|:---|:---|:---|:---|\n`;

        for (const item of skillCatalog) {
          markdown += `| **${item.vaultName}** | \`${item.vaultId}\` | \`${item.skillName}\` | ${item.description} | \`${item.exampleCall}\` |\n`;
        }

        markdown += `\n### Raw JSON Catalog\n\`\`\`json\n${JSON.stringify(skillCatalog, null, 2)}\n\`\`\``;

        // Record audit event
        try {
          await db.insert(schema.auditEvents).values({
            actor_id: context.userId || 'desktop-agent',
            action: 'list_skills',
            target_id: vaultId,
            metadata: { count: skillCatalog.length, status: 'success' },
          });
        } catch {}

        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to list skills: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },

    handleRunSkill: async (args: any, context: ToolCallContext): Promise<ToolCallResult> => {
      const { vaultId, role } = requireAuthorizedLockedVault(args, context);
      const skillName = String(args.skillName || args.skill_name || '');
      const parameters = (args.parameters || args.arguments || {}) as Record<string, unknown>;

      if (!skillName) {
        return {
          content: [{ type: 'text', text: 'Error: skillName is required to execute a skill.' }],
          isError: true,
        };
      }

      const requestBody = { vaultId, skillName, parameters, role };
      const serviceToken = createServiceToken({
        caller: 'tkxel-vault-mcp-gateway',
        userId: context.userId,
        vaultId,
        operation: 'run_skill',
        role,
        body: requestBody,
      });

      const runnerUrl = process.env.SKILL_RUNNER_URL || 'http://localhost:3003';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      timeout.unref();
      try {
        let response: Response;
        try {
          response = await fetch(`${runnerUrl}/api/run-skill`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceToken}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.ok) {
          const data = (await response.json()) as any;
          const sanitized = sanitizeOutput(data.result || JSON.stringify(data, null, 2));

          try {
            await db.insert(schema.auditEvents).values({
              actor_id: context.userId || 'desktop-agent',
              action: 'run_skill',
              target_id: vaultId,
              metadata: {
                vault_id: vaultId,
                skill_name: skillName,
                status: 'success',
              },
            });
          } catch (auditErr) {
            console.error('CRITICAL: Audit record failed to persist:', auditErr);
            return {
              content: [{ type: 'text', text: 'Error: Mandatory audit write failed. Operation aborted.' }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: sanitized,
              },
            ],
          };
        } else {
          const errData = (await response.json().catch(() => ({}))) as any;
          const errMsg = errData.error || `Runner service returned status ${response.status}`;
          return {
            content: [
              {
                type: 'text',
                text: `Error: Skill execution failed (${errMsg})`,
              },
            ],
            isError: true,
          };
        }
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Skill Runner service unavailable (${err.message || 'unreachable'}). In-process execution fallback is disabled in production mode.`,
            },
          ],
          isError: true,
        };
      }
    },

    handleAskVault: async (args: any, context: ToolCallContext): Promise<ToolCallResult> => {
      const { vaultId, role } = requireAuthorizedLockedVault(args, context);
      const query = String(args.query || args.question || '');

      const requestBody = { vaultId, query, role };
      const serviceToken = createServiceToken({
        caller: 'tkxel-vault-mcp-gateway',
        userId: context.userId,
        vaultId,
        operation: 'ask_vault',
        role,
        body: requestBody,
      });

      const runnerUrl = process.env.SKILL_RUNNER_URL || 'http://localhost:3003';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      timeout.unref();
      try {
        let response: Response;
        try {
          response = await fetch(`${runnerUrl}/api/ask-vault`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceToken}`,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.ok) {
          const data = (await response.json()) as any;
          const sanitized = sanitizeOutput(data.answer || JSON.stringify(data, null, 2));

          try {
            await db.insert(schema.auditEvents).values({
              actor_id: context.userId || 'desktop-agent',
              action: 'ask_vault',
              target_id: vaultId,
              metadata: {
                vault_id: vaultId,
                status: 'success',
              },
            });
          } catch (auditErr) {
            console.error('CRITICAL: Audit record failed to persist:', auditErr);
            return {
              content: [{ type: 'text', text: 'Error: Mandatory audit write failed. Operation aborted.' }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: sanitized,
              },
            ],
          };
        } else {
          const errData = (await response.json().catch(() => ({}))) as any;
          const errMsg = errData.error || `Runner service returned status ${response.status}`;
          return {
            content: [
              {
                type: 'text',
                text: `Error: Ask vault failed (${errMsg})`,
              },
            ],
            isError: true,
          };
        }
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: Skill Runner service unavailable (${err.message || 'unreachable'}). In-process execution fallback is disabled in production mode.`,
            },
          ],
          isError: true,
        };
      }
    },
  };
}
