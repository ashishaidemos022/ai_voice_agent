const IMAGE_PATTERN = /!\[[^\]]*\]\([^\n)]+\)/;
const GFM_TABLE_PATTERN = /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}/;

export function containsRichContent(content: string): boolean {
  return IMAGE_PATTERN.test(content) || GFM_TABLE_PATTERN.test(content) || content.includes('"a2ui"');
}
