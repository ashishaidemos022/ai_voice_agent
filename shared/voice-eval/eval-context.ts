export interface EvalToolContext {
  evalRunId: string;
  patientReference: string;
}

/** Adds eval routing to healthcare tool params. Applied client-side only; the LLM never sees these values. */
export function applyEvalContext(params: Record<string, unknown>, ctx: EvalToolContext | null): Record<string, unknown> {
  const rest = { ...params };
  delete rest.eval_run_id;
  return ctx ? { ...rest, patient_reference: ctx.patientReference, eval_run_id: ctx.evalRunId } : rest;
}
