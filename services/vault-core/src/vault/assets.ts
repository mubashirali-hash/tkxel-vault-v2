import { eq, and } from 'drizzle-orm';
import { db } from '../db.js';
import { vaults, assets, auditEvents } from '../schema/index.js';
import { createKmsProvider, EnvelopeEncryption } from '../crypto/kms.js';
import { VaultValidationError } from './create-vault.js';

/** URL scheme stored in Markdown for a vault-hosted image: `![alt](vault-asset://<asset id>)`. */
export const VAULT_ASSET_SCHEME = 'vault-asset://';
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;

/**
 * Raster image formats only, each confirmed by its file signature. SVG is deliberately excluded: it can
 * carry script and would execute in the application's origin.
 */
const IMAGE_SIGNATURES: Array<{ mime: string; extension: string; matches: (b: Buffer) => boolean }> = [
  { mime: 'image/png', extension: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', extension: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', extension: 'gif', matches: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { mime: 'image/webp', extension: 'webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export interface AssetSummary {
  id: string;
  vault_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  /** Reference to put in Markdown. */
  markdown_url: string;
}

function safeFileName(name: string, extension: string): string {
  const base = (name || 'image')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120) || 'image';
  return /\.[A-Za-z0-9]{2,5}$/.test(base) ? base : `${base}.${extension}`;
}

/**
 * Stores an image in an open vault, encrypted under the vault data key (FR-02, NFR-01).
 * The declared type is ignored: the format is taken from the bytes themselves.
 */
export async function storeVaultAsset(params: {
  vaultId: string;
  fileName: string;
  data: Buffer;
  actorId: string;
}): Promise<AssetSummary> {
  const { data } = params;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw new VaultValidationError('Image data is required');
  }
  if (data.length > MAX_ASSET_BYTES) {
    throw new VaultValidationError(`Images must be ${MAX_ASSET_BYTES / (1024 * 1024)} MB or smaller`);
  }
  const format = IMAGE_SIGNATURES.find((f) => f.matches(data));
  if (!format) {
    throw new VaultValidationError('Only PNG, JPEG, GIF and WebP images can be stored');
  }

  const vaultRows = await db.select({ id: vaults.id, mode: vaults.mode, data_key_id: vaults.data_key_id })
    .from(vaults)
    .where(eq(vaults.id, params.vaultId))
    .limit(1);
  const vault = vaultRows[0];
  if (!vault || !vault.data_key_id) {
    throw new Error('not_found');
  }
  if (vault.mode !== 'open') {
    throw new VaultValidationError('Images can only be added to open vaults');
  }

  const dek = await createKmsProvider().unwrapKey(vault.data_key_id);
  let encrypted: Buffer;
  try {
    encrypted = EnvelopeEncryption.encrypt(data, dek);
  } finally {
    dek.fill(0);
  }

  const fileName = safeFileName(params.fileName, format.extension);
  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(assets)
      .values({
        vault_id: vault.id,
        file_name: fileName,
        mime_type: format.mime,
        size_bytes: data.length,
        encrypted_blob: encrypted,
        created_by: params.actorId,
      })
      .returning({ id: assets.id });

    await tx.insert(auditEvents).values({
      actor_id: params.actorId,
      action: 'upload_asset',
      target_id: row.id,
      metadata: { vault_id: vault.id, mime_type: format.mime, size_bytes: data.length },
    });

    return {
      id: row.id,
      vault_id: vault.id,
      file_name: fileName,
      mime_type: format.mime,
      size_bytes: data.length,
      markdown_url: `${VAULT_ASSET_SCHEME}${row.id}`,
    };
  });
}

/** Decrypts an asset. The caller must already have verified read access to `vaultId`. */
export async function readVaultAsset(params: { vaultId: string; assetId: string }): Promise<{
  fileName: string;
  mimeType: string;
  data: Buffer;
} | null> {
  const rows = await db
    .select({
      file_name: assets.file_name,
      mime_type: assets.mime_type,
      encrypted_blob: assets.encrypted_blob,
      mode: vaults.mode,
      data_key_id: vaults.data_key_id,
    })
    .from(assets)
    .innerJoin(vaults, eq(assets.vault_id, vaults.id))
    .where(and(eq(assets.id, params.assetId), eq(assets.vault_id, params.vaultId)))
    .limit(1);
  const row = rows[0];
  // Locked vaults expose no raw content of any kind
  if (!row || row.mode !== 'open') return null;

  const dek = await createKmsProvider().unwrapKey(row.data_key_id);
  try {
    return { fileName: row.file_name, mimeType: row.mime_type, data: EnvelopeEncryption.decrypt(row.encrypted_blob, dek) };
  } finally {
    dek.fill(0);
  }
}

/** The vault an asset belongs to, for authorization. Returns null for an unknown asset. */
export async function getAssetVaultId(assetId: string): Promise<string | null> {
  const rows = await db.select({ vault_id: assets.vault_id }).from(assets).where(eq(assets.id, assetId)).limit(1);
  return rows[0]?.vault_id ?? null;
}
