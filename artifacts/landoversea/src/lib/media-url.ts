/**
 * Resolves API object paths through the authenticated storage endpoint while
 * leaving already-absolute media URLs unchanged.
 */
export function resolveMediaUrl(url?: string | null): string {
  if (!url || !url.startsWith('/objects/')) return url ?? '';

  const baseUrl = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${baseUrl}api/storage/objects/${url.slice('/objects/'.length)}`;
}