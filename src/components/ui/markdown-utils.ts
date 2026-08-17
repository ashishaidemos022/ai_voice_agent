const IMAGE_PATTERN = /!\[[^\]]*\]\([^\n)]+\)/;
const GFM_TABLE_PATTERN = /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/;

export function isDirectImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)) return true;
    return url.hostname === 'cdn.shopify.com' && url.pathname.includes('/s/files/');
  } catch {
    return false;
  }
}

export function containsRichContent(content: string): boolean {
  const urls = content.match(/https?:\/\/[^\s)>|]+/g) || [];
  return IMAGE_PATTERN.test(content)
    || GFM_TABLE_PATTERN.test(content)
    || content.includes('"a2ui"')
    || urls.some(isDirectImageUrl);
}
