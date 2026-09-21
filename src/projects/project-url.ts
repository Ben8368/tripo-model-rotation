export function validProjectUrl(value: unknown, id: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://studio.tripo3d.ai' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?workspace\/generate\/[^/]*?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    if (!match || match[1].toLowerCase() !== String(id).toLowerCase()) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}
