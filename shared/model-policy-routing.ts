import { shouldRunRagForTurn } from './rag-routing.ts';

export type ModelPolicyRoute = 'adapter' | 'adapter-unavailable' | 'rag' | 'voice';

export function resolveModelPolicyRoute(
  mode: 'rag' | 'adapter' | 'automatic',
  hasAdapter: boolean,
  text: string
): ModelPolicyRoute {
  if (!text.trim()) return 'voice';

  // An explicit adapter selection is a hard routing decision. It must not be
  // filtered by the separate RAG heuristic, which is intentionally tuned for
  // deciding when retrieval is useful.
  if (mode === 'adapter') return hasAdapter ? 'adapter' : 'adapter-unavailable';

  if (!shouldRunRagForTurn(text)) return 'voice';
  if (mode === 'automatic' && hasAdapter) return 'adapter';
  return 'rag';
}
