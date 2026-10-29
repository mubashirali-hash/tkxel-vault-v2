/**
 * Single source for the API location. Set VITE_API_URL (including the `/api` suffix) per deployment;
 * the localhost value is the local development default only.
 */
export const API_URL: string = (
  (import.meta as any).env?.VITE_API_URL || 'http://localhost:3002/api'
).replace(/\/+$/, '');

/** API origin without the trailing `/api` segment. */
export const API_ORIGIN: string = API_URL.replace(/\/api$/, '');
