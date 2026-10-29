import Image from '@tiptap/extension-image';
import { API_URL } from '../../utils/api-base.js';
import { getAuthToken } from '../../utils/storage.js';

/** Markdown reference for an image stored in the vault: `![alt](vault-asset://<asset id>)`. */
export const VAULT_ASSET_SCHEME = 'vault-asset://';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assetIdFromSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !src.startsWith(VAULT_ASSET_SCHEME)) return null;
  const id = src.slice(VAULT_ASSET_SCHEME.length);
  return ASSET_ID.test(id) ? id : null;
}

/** Decrypted image bytes are fetched with the caller's token and held as object URLs for this session only. */
const objectUrls = new Map<string, Promise<string>>();

function loadAsset(assetId: string): Promise<string> {
  let pending = objectUrls.get(assetId);
  if (!pending) {
    pending = (async () => {
      const token = getAuthToken();
      const res = await fetch(`${API_URL}/assets/${assetId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`asset ${res.status}`);
      return URL.createObjectURL(await res.blob());
    })();
    pending.catch(() => objectUrls.delete(assetId));
    objectUrls.set(assetId, pending);
  }
  return pending;
}

export async function uploadVaultImage(vaultId: string, file: File): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Only PNG, JPEG, GIF and WebP images can be added.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Images must be 5 MB or smaller.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const token = getAuthToken();
  const res = await fetch(`${API_URL}/vaults/${vaultId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ file_name: file.name || 'image', data_base64: btoa(binary) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'The image could not be saved.');
  }
  return data.asset.markdown_url as string;
}

/**
 * Image node for the editor (FR-02). The stored `src` stays the portable `vault-asset://` reference, so the
 * Markdown is clean; the node view swaps in an authenticated object URL only for display. External image
 * URLs are not loaded: a remote image would let a page report who opened it.
 */
export const VaultImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img');
      img.className = 'vault-image';
      img.alt = node.attrs.alt || '';
      if (node.attrs.title) img.title = node.attrs.title;
      img.loading = 'lazy';

      const assetId = assetIdFromSrc(node.attrs.src);
      if (assetId) {
        img.setAttribute('data-asset-id', assetId);
        loadAsset(assetId)
          .then((url) => {
            img.src = url;
          })
          .catch(() => {
            img.alt = `${node.attrs.alt || 'Image'} (unavailable)`;
            img.classList.add('vault-image--unavailable');
          });
      } else {
        img.alt = `${node.attrs.alt || 'Image'} (external images are not displayed)`;
        img.classList.add('vault-image--unavailable');
      }
      return { dom: img };
    };
  },
});
