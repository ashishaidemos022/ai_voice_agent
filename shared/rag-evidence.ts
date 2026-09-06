/** Use provider search results, never model-authored filenames or quotations. */
export function retrievedCitations(output: unknown): Array<{ file_id: string; title: string; snippet: string }> {
  if (!Array.isArray(output)) return [];
  const seen = new Set<string>();
  return output.flatMap(item => item?.type === 'file_search_call' && Array.isArray(item.results) ? item.results : [])
    .filter(result => {
      if (typeof result?.file_id !== 'string' || typeof result?.text !== 'string' || !result.text.trim()) return false;
      const key = `${result.file_id}:${result.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5).map(result => ({ file_id: result.file_id, title: result.filename || result.file_id, snippet: result.text }));
}
