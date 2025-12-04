export function normalizeIdentifier(value: string | undefined | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildN8NToolName(name: string, id: string): string {
  const normalized = normalizeIdentifier(name) || 'n8n';
  const suffix = id.replace(/-/g, '').slice(-8);
  const truncated = normalized.slice(0, 30);
  return `trigger_n8n_${truncated}_${suffix}`;
}
