type EmbedRuntimeConfig = {
  apiBaseUrl?: string;
};

type EmbedWindow = Window & {
  VoiceAgentEmbed?: EmbedRuntimeConfig;
  AgenticChat?: EmbedRuntimeConfig;
  MyVoiceAgent?: EmbedRuntimeConfig;
  myVoiceAgent?: EmbedRuntimeConfig;
};

export function resolveEmbedApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const queryBase =
    params.get('api_base') ||
    params.get('apiBase') ||
    params.get('apiBaseUrl');
  const win = window as EmbedWindow;
  const globalBase =
    win.VoiceAgentEmbed?.apiBaseUrl ||
    win.AgenticChat?.apiBaseUrl ||
    win.MyVoiceAgent?.apiBaseUrl ||
    win.myVoiceAgent?.apiBaseUrl;
  const envBase = import.meta.env.VITE_EMBED_API_BASE_URL as string | undefined;
  const base = queryBase || globalBase || envBase || window.location.origin;
  return base ? base.replace(/\/$/, '') : null;
}

export function buildEmbedFunctionUrl(base: string | null, functionName: string): string | null {
  if (!base) return null;
  const normalized = base.replace(/\/$/, '');
  if (normalized.endsWith('/functions/v1')) {
    return `${normalized}/${functionName}`;
  }
  return `${normalized}/functions/v1/${functionName}`;
}
