export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Resolve an image URL for rendering.
 *
 * storageType = 'hosted' → filePath is already a full HTTPS URL, return as-is.
 * storageType = 'local'  → filePath is either a full URL (pass-through) or a
 *                          relative server path, prepend API_BASE.
 *
 * Desktop: VITE_API_BASE_URL is unset → API_BASE = '' → relative URL → Vite proxy.
 * Cloud:   VITE_API_BASE_URL = 'https://api.example.com' → full URL.
 * Mobile (Path A): service layer intercepts before this runs.
 */
export function getImageUrl(filePath, storageType = 'local') {
  if (!filePath) return null;
  if (storageType === 'hosted') return filePath;
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  return `${API_BASE}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}
