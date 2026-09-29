import { getScenario } from '../scenarios/index.ts';
import { buildBrainRequest, parseBrainDecision, type BrainRequest, type TranscriptTurn } from './brain-prompt.ts';

export interface CallerRun { id: string; scenario_id: string; status: string; agent_config_id: string | null }

export interface CallerDeps {
  loadRun(ownerId: string, runId: string): Promise<CallerRun | null>;
  resolveElevenLabsKey(ownerId: string, agentConfigId: string | null): Promise<string | null>;
  brain(request: BrainRequest): Promise<string>;
  tts(apiKey: string, voiceId: string, text: string): Promise<Uint8Array>;
}

export interface CallerResponse { status: number; body: Record<string, unknown> }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function sanitizeTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {};
    const role = record.role;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    return (role === 'agent' || role === 'caller') && text ? [{ role, text }] : [];
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleCallerRequest(deps: CallerDeps, ownerId: string, body: Record<string, unknown>): Promise<CallerResponse> {
  const runId = typeof body.run_id === 'string' && UUID_PATTERN.test(body.run_id) ? body.run_id : null;
  const run = runId ? await deps.loadRun(ownerId, runId) : null;
  if (!run) return { status: 404, body: { error: 'Eval run not found' } };
  if (run.status !== 'running') return { status: 409, body: { error: 'Eval run is not running' } };
  const scenario = getScenario(run.scenario_id);
  if (!scenario) return { status: 400, body: { error: 'Unknown scenario' } };
  if (body.action !== 'render' && body.action !== 'next_turn') return { status: 400, body: { error: 'Unknown action' } };

  const apiKey = await deps.resolveElevenLabsKey(ownerId, run.agent_config_id);
  if (!apiKey) return { status: 400, body: { error: 'No ElevenLabs key for the synthetic caller' } };
  const voiceId = scenario.persona.voiceId;

  if (body.action === 'render') {
    try {
      const lines = [];
      for (const [index, beat] of scenario.beats.entries()) {
        if (!beat.line) continue;
        lines.push({ beat_index: index, text: beat.line, audio_b64: bytesToBase64(await deps.tts(apiKey, voiceId, beat.line)) });
      }
      return { status: 200, body: { lines } };
    } catch (error) {
      return { status: 502, body: { error: `Caller TTS failed: ${errorMessage(error)}` } };
    }
  }

  const fired = new Set(
    (Array.isArray(body.beats_fired) ? body.beats_fired : []).filter((v): v is number => Number.isInteger(v) && v >= 0 && v < scenario.beats.length)
  );
  const hiddenFacts = scenario.beats.flatMap((beat, i) => (beat.kind === 'correction' && beat.correctedFact && !fired.has(i) ? [beat.correctedFact] : []));
  let decision;
  try {
    decision = parseBrainDecision(await deps.brain(buildBrainRequest(scenario, sanitizeTranscript(body.transcript), hiddenFacts)));
  } catch (error) {
    return { status: 502, body: { error: `Caller brain failed: ${errorMessage(error)}` } };
  }
  try {
    const audio = decision.text ? bytesToBase64(await deps.tts(apiKey, voiceId, decision.text)) : null;
    return { status: 200, body: { action: decision.action, text: decision.text, audio_b64: audio } };
  } catch (error) {
    return { status: 502, body: { error: `Caller TTS failed: ${errorMessage(error)}` } };
  }
}
