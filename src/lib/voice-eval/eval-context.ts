import type { EvalToolContext } from '../../../shared/voice-eval/eval-context';

let active: EvalToolContext | null = null;

export function setActiveEvalContext(context: EvalToolContext | null): void {
  active = context;
}

export function getActiveEvalContext(): EvalToolContext | null {
  return active;
}
