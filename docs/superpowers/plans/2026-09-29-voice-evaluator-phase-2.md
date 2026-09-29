# Voice Evaluator Phase 2: Synthetic Caller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a healthcare scenario, switch the Evaluator to **Synthetic**, and click Start. A scripted caller (OpenAI brain → ElevenLabs TTS → WebAudio noise → persistent synthetic mic track) then talks to the live agent hands-free until the call ends and is scored.

**Architecture:** The pure logic lives in `shared/voice-eval/caller/`: the turn detector, beat scheduler, brain prompt and server handler. It is unit-tested and bundled by a new `voice-eval-caller` Edge Function. The browser side lives in `src/lib/voice-eval/synthetic-caller/`. It builds a `MediaStreamTrack` from an `AudioContext`, and attaches it to the voice adapter through a new optional `attachSyntheticInput`, which keeps it for the whole call. The caller reads and publishes on the existing eval signal bus, so its utterance timings become scorer evidence.

**Tech Stack:** React 18 + TypeScript + Vite, WebAudio, WebRTC, Supabase Edge Functions (Deno), OpenAI Responses API (structured output), ElevenLabs TTS REST, and `node --experimental-strip-types --test`.

**Spec:** `docs/superpowers/specs/2026-09-29-voice-evaluator-phase-2-design.md`. Parent: `docs/superpowers/specs/2026-09-29-voice-agent-evaluator-design.md`.

**One deviation from the spec (flagged for the owner):**
- **What:** before any non-barge-in utterance, the caller waits until the agent's output volume (`adapter.getOutputVolume()`) has stayed below 0.02 for 300 ms, for at most 8 s.
- **Why:** on WebRTC and GPT-Live the agent's "not speaking" state can arrive before its audio has finished playing.
- **Scope:** this only guards playback; turn detection is still event-driven, as the spec requires.

## Global Constraints

- Caller brain model: `OPENAI_MODELS.chat.mini` (`gpt-5.4-mini`), called through the OpenAI Responses API with `text.format` `json_schema`, `strict: true`, and `reasoning: { effort: 'none' }`.
- Caller TTS: ElevenLabs `POST /v1/text-to-speech/{voice_id}?output_format=pcm_24000`, `model_id: 'eleven_flash_v2_5'`; the voice is the scenario `persona.voiceId`.
- ElevenLabs key lookup:
  1. the run's agent config `voice_provider_key_id`, if that key's provider is `elevenlabs`;
  2. otherwise the owner's newest `va_provider_keys` row with provider `elevenlabs` (`user_id = voice_eval_runs.owner_id`);
  3. if neither exists, return 400 `No ElevenLabs key for the synthetic caller`.
- Turn gap: 600 ms plus 0–300 ms of seeded jitter. Quiet fallback: 10 s. Opening fallback: 4 s. A tool call with no result counts as stale after 30 s.
- Barge-in gate: cutoff ≤ 500 ms (`BARGE_IN_MAX_MS`). Stop window: 5 s, and no stop inside the window counts as a failed cutoff.
- Caps: 4 minutes wall clock, 30 caller turns. Hang-up delay: 1.5 s. Brain/TTS: one retry after 500 ms, and a second failure is `harness_error`.
- Noise: procedural, with RMS 0.03 (about 10 dB SNR). The speakerphone noise setting is a 300–3400 Hz band-pass plus a waveshaper on the caller voice.
- Brain line clamp: 400 characters. Transcript sent to the brain: the last 60 turns, each clamped to 1000 characters.
- Evidence kinds added: `agent_audio_stop`, `caller_utterance`, `beat`. There is no DB migration.
- Tests run with `node --experimental-strip-types --test`. Any `src/` file imported by a Node test must give **value** imports an explicit `.ts` extension (type-only imports may omit it).
- Git: commit on `main` and push to `origin` right after each commit (owner preference). End every commit message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Subagents use the same model as the session (owner's global instruction).

## Review Focus

1. **Agent state says "idle" while its audio is still playing** (WebRTC/GPT-Live). The caller must not clip the agent's last words. Pinned by the playback-guard test in Task 9.
2. **A tool call never returns** (EHR hang). The caller must not wait forever; after 30 s the tool counts as stale and the quiet fallback can fire. Pinned in Task 3.
3. **The agent goes silent after a tool result.** The caller must not reply to the pre-tool "one moment" line. It waits for new agent speech, or nudges after 10 s. Pinned in Task 3.
4. **The owner aborts or hangs up while a brain request is in flight.** No speech after stop and no second hang-up. Pinned in Task 9.
5. **The brain returns an empty, overlong or malformed line.** Empty `say` and bad JSON are rejected, and long lines are clamped (Task 5). One retry, then `invalid_harness` (Task 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/voice-eval/types.ts` (modify) | `Beat.anchor`; the new evidence kinds |
| `shared/voice-eval/scenario.ts` (modify) | Anchor and beat-shape validation |
| `shared/voice-eval/scenarios/healthcare.ts` (modify) | Anchors on hc-05 (v3) and hc-06 (v4) |
| `shared/voice-eval/scoring/latency.ts` (modify) | Latency from caller utterance end when synthetic |
| `shared/voice-eval/scoring/turn-taking.ts` (modify) | Barge-in, talk-over and silence from exact utterance windows |
| `shared/voice-eval/caller/random.ts` (create) | Seeded PRNG |
| `shared/voice-eval/caller/turn-detector.ts` (create) | Event-driven "agent turn ended" / "agent quiet" |
| `shared/voice-eval/caller/beat-scheduler.ts` (create) | Beat or brain decision per caller turn; barge-in arming |
| `shared/voice-eval/caller/brain-prompt.ts` (create) | Brain request builder, output schema, decision parser |
| `shared/voice-eval/caller/server.ts` (create) | `render` / `next_turn` handler with injected deps |
| `supabase/functions/voice-eval-caller/index.ts` (create) | Deno wiring: auth, DB, OpenAI, ElevenLabs |
| `src/lib/voice-eval/synthetic-caller/types.ts` (create) | `CallerSource`, `MicLike`, `CallerApi`, `CallerRunClosedError` |
| `src/lib/voice-eval/synthetic-caller/pcm.ts` (create) | Base64 PCM16 → Float32 |
| `src/lib/voice-eval/synthetic-caller/noise.ts` (create) | Procedural café and car noise beds |
| `src/lib/voice-eval/synthetic-caller/synthetic-mic.ts` (create) | `createSyntheticMic` (WebAudio → MediaStream track) |
| `src/lib/voice-eval/synthetic-caller/synthetic-caller.ts` (create) | `SyntheticCaller` orchestration |
| `src/lib/voice-eval/synthetic-input.ts` (create) | WebSocket PCM pump from a track via the existing worklet |
| `src/lib/voice-eval/caller-api.ts` (create) | Browser client for `voice-eval-caller` |
| `src/lib/voice-adapters/types.ts` (modify) | Optional `attachSyntheticInput` / `detachSyntheticInput` |
| `src/lib/realtime-client.ts` (modify) | Attach/detach for WebRTC and WebSocket; `sendAudio` gating |
| `src/lib/voice-adapters/elevenlabs-adapter.ts` (modify) | Delegates attach/detach |
| `src/hooks/useVoiceAgent.ts` (modify) | Publishes `agent_audio_stop`; exposes `getAdapter` |
| `src/hooks/useVoiceEval.ts` (modify) | `callerType`, caller lifecycle, `callerStatus` |
| `src/components/voice-eval/EvaluatorPanel.tsx` (modify) | Live You/Synthetic switch and caller status |
| `src/components/VoiceAgent.tsx` (modify) | Passes `getAdapter` and `hangUp` to the panel |
| `tests/helpers/voice-eval-fixtures.ts` (modify) | `callerUtterance`, `agentAudioStop`, `beatEvent` |
| `tests/voice-eval-caller-*.test.ts` (create) | New tests, picked up by `npm run test:voice-eval` |

---

### Task 1: Beat anchors and new evidence kinds

**Files:**
- Modify: `shared/voice-eval/types.ts` (the `Beat` interface and the `EvidenceEvent` union)
- Modify: `shared/voice-eval/scenario.ts` (the beats loop in `validateScenario`)
- Modify: `shared/voice-eval/scenarios/healthcare.ts` (hc-05 and hc-06 entries)
- Test: `tests/voice-eval-scenarios.test.ts`

**Interfaces:**
- Produces:
  - `interface BeatAnchor { afterTool: HealthcareAction }`
  - `Beat.anchor?: BeatAnchor`
  - `EvidenceEvent` gains:
    - `{ kind: 'agent_audio_stop'; atMs }`
    - `{ kind: 'caller_utterance'; atMs; durationMs; text; source: 'brain' | 'beat'; beatIndex: number | null }` (here `atMs` is the utterance **start**)
    - `{ kind: 'beat'; atMs; beatIndex; beatKind: BeatKind }`
  - Because `VoiceEvalSignal` derives from `EvidenceEvent`, it gains the same kinds with `at` in place of `atMs`.

- [ ] **Step 1: Write the failing tests.** Append them to `tests/voice-eval-scenarios.test.ts`:

```ts
test('hc-05 and hc-06 beats are anchored to tool results', () => {
  const hc05 = getScenario('hc-05') as Scenario;
  const hc06 = getScenario('hc-06') as Scenario;
  assert.equal(hc05.version, 3);
  assert.deepEqual(hc05.beats[0].anchor, { afterTool: 'search_availability' });
  assert.equal(hc06.version, 4);
  assert.deepEqual(hc06.beats[0].anchor, { afterTool: 'hold_slot' });
});

test('validator rejects unknown anchors and malformed beats', () => {
  const base = getScenario('hc-06') as Scenario;
  const errors = validateScenario({
    ...base,
    beats: [
      { kind: 'barge_in', line: 'x', afterAgentSpeechMs: 100, anchor: { afterTool: 'teleport' as never } },
      { kind: 'say', afterTurn: 1 },
      { kind: 'silence', afterTurn: 1 },
      { kind: 'barge_in', line: 'y' }
    ]
  });
  assert.ok(errors.some((e) => e.includes('unknown anchor action teleport')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 1 needs a line')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 2 needs durationMs')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('beat 3 needs afterAgentSpeechMs')), errors.join('\n'));
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-scenarios.test.ts`
Expected: FAIL. The hc-05 version is 2, not 3, and the validator reports none of the new errors.

- [ ] **Step 3: Implement the types.** In `shared/voice-eval/types.ts`, replace the `Beat` interface:

```ts
export interface BeatAnchor {
  /** The beat becomes eligible only after a successful result for this healthcare action. */
  afterTool: HealthcareAction;
}

export interface Beat {
  kind: BeatKind;
  line?: string;
  afterTurn?: number;
  afterAgentSpeechMs?: number;
  durationMs?: number;
  correctedFact?: string;
  anchor?: BeatAnchor;
}
```

Then add three members to the `EvidenceEvent` union, directly after the `agent_audio_start` member:

```ts
  | { kind: 'agent_audio_stop'; atMs: number }
  /** A synthetic caller line; atMs is when playback started. */
  | { kind: 'caller_utterance'; atMs: number; durationMs: number; text: string; source: 'brain' | 'beat'; beatIndex: number | null }
  | { kind: 'beat'; atMs: number; beatIndex: number; beatKind: BeatKind }
```

- [ ] **Step 4: Implement the validation.** In `shared/voice-eval/scenario.ts`, replace the existing beats loop:

```ts
  s.beats.forEach((beat, index) => {
    if (beat.correctedFact && !s.facts[beat.correctedFact]) errors.push(`${s.id}: correctedFact ${beat.correctedFact} is not a fact`);
    if (beat.anchor && !ACTIONS.has(beat.anchor.afterTool)) errors.push(`${s.id}: unknown anchor action ${beat.anchor.afterTool}`);
    if (beat.kind !== 'silence' && !beat.line?.trim()) errors.push(`${s.id}: beat ${index} needs a line`);
    if (beat.kind === 'silence' && !(Number(beat.durationMs) > 0)) errors.push(`${s.id}: beat ${index} needs durationMs`);
    if (beat.kind === 'barge_in' && !(typeof beat.afterAgentSpeechMs === 'number' && beat.afterAgentSpeechMs >= 0)) {
      errors.push(`${s.id}: beat ${index} needs afterAgentSpeechMs`);
    }
  });
```

- [ ] **Step 5: Anchor the two scenarios.** In `shared/voice-eval/scenarios/healthcare.ts`:
  - hc-05: change `version: 2` to `version: 3`, and set its beats to:

```ts
    beats: [{ kind: 'correction', afterTurn: 3, anchor: { afterTool: 'search_availability' }, line: 'Uh, wait — actually, make that Thursday, not Tuesday.', correctedFact: 'preferredDay' }],
```

  - hc-06: change `version: 3` to `version: 4`, and set its beats to:

```ts
    beats: [{ kind: 'barge_in', anchor: { afterTool: 'hold_slot' }, afterAgentSpeechMs: 1200, line: 'Sorry — can we do the afternoon one instead?' }],
```

- [ ] **Step 6: Run the scenario tests and the full eval suite.**

Run: `node --experimental-strip-types --test tests/voice-eval-scenarios.test.ts && npm run test:voice-eval`
Expected: PASS. The existing validator test still passes.

- [ ] **Step 7: Commit and push.**

```bash
git add shared/voice-eval/types.ts shared/voice-eval/scenario.ts shared/voice-eval/scenarios/healthcare.ts tests/voice-eval-scenarios.test.ts
git commit -m "Anchor eval beats to tool results and add synthetic caller evidence kinds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 2: Synthetic-aware latency and turn-taking scoring

**Files:**
- Modify: `shared/voice-eval/scoring/latency.ts`
- Modify: `shared/voice-eval/scoring/turn-taking.ts`
- Modify: `tests/helpers/voice-eval-fixtures.ts`
- Test: `tests/voice-eval-caller-scoring.test.ts` (create)

**Interfaces:**
- Consumes: the Task 1 evidence kinds.
- Produces:
  - fixture helpers `callerUtterance(atMs, durationMs, text?, source?, beatIndex?)`, `agentAudioStop(atMs)` and `beatEvent(atMs, beatIndex, beatKind)`;
  - `BARGE_IN_STOP_WINDOW_MS = 5000`, exported from `turn-taking.ts`.
  - `scoreLatency` and `scoreTurnTaking` keep their signatures. When any `caller_utterance` is present, the run is "synthetic" and the new paths apply.

- [ ] **Step 1: Add the fixture helpers.** Append to `tests/helpers/voice-eval-fixtures.ts`:

```ts
export function callerUtterance(atMs: number, durationMs: number, text = 'okay', source: 'brain' | 'beat' = 'brain', beatIndex: number | null = null): EvidenceEvent {
  return { kind: 'caller_utterance', atMs, durationMs, text, source, beatIndex };
}

export function agentAudioStop(atMs: number): EvidenceEvent {
  return { kind: 'agent_audio_stop', atMs };
}

export function beatEvent(atMs: number, beatIndex: number, beatKind: 'barge_in' | 'correction' | 'silence' | 'say'): EvidenceEvent {
  return { kind: 'beat', atMs, beatIndex, beatKind };
}
```

- [ ] **Step 2: Write the failing tests.** Create `tests/voice-eval-caller-scoring.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLatency } from '../shared/voice-eval/scoring/latency.ts';
import { scoreTurnTaking } from '../shared/voice-eval/scoring/turn-taking.ts';
import { agentAudio, agentAudioStop, agentSays, beatEvent, callerSays, callerUtterance, toolCall, turnMetric } from './helpers/voice-eval-fixtures.ts';

test('synthetic latency runs from caller utterance end to the next agent audio start', () => {
  const result = scoreLatency([
    callerUtterance(1000, 2000), agentAudio(3600),
    callerUtterance(6000, 1000), toolCall(7100, 't1', { action: 'search_availability' }), agentAudio(9500),
    turnMetric(9600, 50)
  ]);
  assert.equal(result.turnCount, 2);
  assert.equal(result.p50Ms, 600);
  assert.equal(result.p95Ms, 2500);
  assert.equal(result.maxMs, 2500);
  assert.equal(result.toolTurnP95Ms, 2500);
  assert.equal(result.status, 'fail');
});

test('synthetic latency with utterances but no agent reply is no_data', () => {
  assert.equal(scoreLatency([callerUtterance(1000, 1000), turnMetric(3000, 400)]).status, 'no_data');
});

test('synthetic barge-in cutoff is measured from the beat utterance start', () => {
  const base = [agentAudio(1000), beatEvent(2200, 0, 'barge_in'), callerUtterance(2200, 1500, 'Sorry — afternoon?', 'beat', 0)];
  const fast = scoreTurnTaking([...base, agentAudioStop(2550)]);
  assert.deepEqual(fast.bargeIns, [350]);
  assert.equal(fast.bargeInPass, true);
  const slow = scoreTurnTaking([...base, agentAudioStop(3100)]);
  assert.equal(slow.bargeInPass, false);
  const never = scoreTurnTaking(base);
  assert.equal(never.bargeInPass, false);
  assert.equal(never.status, 'fail');
});

test('a beat utterance while the agent is silent is not a barge-in', () => {
  const result = scoreTurnTaking([agentAudio(1000), agentAudioStop(2000), beatEvent(2200, 0, 'barge_in'), callerUtterance(2200, 1000, 'x', 'beat', 0)]);
  assert.deepEqual(result.bargeIns, []);
  assert.equal(result.bargeInPass, null);
});

test('synthetic talk-over uses exact utterance windows and ignores the barge-in beat', () => {
  const result = scoreTurnTaking([
    callerUtterance(1000, 2000), agentAudio(1500), agentAudioStop(1900),
    agentAudio(4000), beatEvent(4300, 0, 'barge_in'), callerUtterance(4300, 1000, 'Sorry', 'beat', 0),
    agentAudioStop(4600), agentAudio(5000)
  ]);
  assert.equal(result.talkOverCount, 1);
  assert.deepEqual(result.bargeIns, [300]);
  assert.equal(result.status, 'warn');
});

test('synthetic silence check uses exact utterance times, not transcript back-dating', () => {
  const human = [
    agentSays(1000, 'What is your date of birth?'),
    callerSays(11000, 'it is the fourteenth of february nineteen eighty eight okay'),
    agentAudio(12500)
  ];
  assert.equal(scoreTurnTaking(human).silenceViolations, 0);
  assert.equal(scoreTurnTaking([...human, callerUtterance(10000, 1000)]).silenceViolations, 1);
});
```

- [ ] **Step 3: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-scoring.test.ts`
Expected: FAIL. For example, `turnCount` is 1 (from the `turn_metric`) instead of 2.

- [ ] **Step 4: Implement the latency change.** Replace the body of `shared/voice-eval/scoring/latency.ts` with:

```ts
import { percentile } from '../stats.ts';
import type { EvidenceEvent, LatencyResult, LatencyThresholds } from '../types.ts';

export const DEFAULT_LATENCY_THRESHOLDS: LatencyThresholds = { p95PassMs: 1000, p95WarnMs: 1500 };

interface Sample { ms: number; tool: boolean }
type Utterance = Extract<EvidenceEvent, { kind: 'caller_utterance' }>;

// Synthetic runs know exactly when the caller stopped talking: measure to the agent's next audio start.
function utteranceSamples(events: EvidenceEvent[]): Sample[] | null {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const utterances = sorted.filter((e): e is Utterance => e.kind === 'caller_utterance');
  if (!utterances.length) return null;
  return utterances.flatMap((utterance, index) => {
    const end = utterance.atMs + utterance.durationMs;
    const nextStart = utterances[index + 1]?.atMs ?? Number.POSITIVE_INFINITY;
    const reply = sorted.find((e) => e.kind === 'agent_audio_start' && e.atMs >= end && e.atMs < nextStart);
    if (!reply) return [];
    const tool = sorted.some((e) => e.kind === 'tool_call' && e.atMs >= end && e.atMs < nextStart);
    return [{ ms: reply.atMs - end, tool }];
  });
}

function metricSamples(events: EvidenceEvent[]): Sample[] {
  return events.flatMap((event) =>
    event.kind === 'turn_metric' && event.firstAudioMs !== null && event.firstAudioMs >= 0
      ? [{ ms: event.firstAudioMs, tool: event.toolCallMs !== null }]
      : []
  );
}

export function scoreLatency(events: EvidenceEvent[], thresholds: LatencyThresholds = DEFAULT_LATENCY_THRESHOLDS): LatencyResult {
  const samples = utteranceSamples(events) ?? metricSamples(events);
  const values = samples.map((sample) => sample.ms);
  if (!values.length) {
    return { status: 'no_data', p50Ms: null, p95Ms: null, maxMs: null, turnCount: 0, toolTurnP95Ms: null };
  }
  const p95 = percentile(values, 0.95) as number;
  return {
    status: p95 <= thresholds.p95PassMs ? 'pass' : p95 <= thresholds.p95WarnMs ? 'warn' : 'fail',
    p50Ms: percentile(values, 0.5),
    p95Ms: p95,
    maxMs: Math.max(...values),
    turnCount: values.length,
    toolTurnP95Ms: percentile(samples.filter((sample) => sample.tool).map((sample) => sample.ms), 0.95)
  };
}
```

- [ ] **Step 5: Implement the turn-taking change.** In `shared/voice-eval/scoring/turn-taking.ts`, keep the constants and `callerActivityStart`. Add the helpers below after `callerActivityStart`, then replace `scoreTurnTaking` with the version shown:

```ts
export const BARGE_IN_STOP_WINDOW_MS = 5000;

type Utterance = Extract<EvidenceEvent, { kind: 'caller_utterance' }>;

function bargeInBeatIndexes(sorted: EvidenceEvent[]): Set<number> {
  return new Set(sorted.flatMap((e) => (e.kind === 'beat' && e.beatKind === 'barge_in' ? [e.beatIndex] : [])));
}

function isBargeUtterance(utterance: Utterance, bargeBeats: Set<number>): boolean {
  return utterance.source === 'beat' && utterance.beatIndex !== null && bargeBeats.has(utterance.beatIndex);
}

function agentSpeakingAt(sorted: EvidenceEvent[], atMs: number): boolean {
  let speaking = false;
  for (const e of sorted) {
    if (e.atMs > atMs) break;
    if (e.kind === 'agent_audio_start') speaking = true;
    else if (e.kind === 'agent_audio_stop') speaking = false;
  }
  return speaking;
}

// Cutoff = first agent audio stop after the caller started interrupting; no stop within the window fails.
function syntheticBargeIns(sorted: EvidenceEvent[], utterances: Utterance[], bargeBeats: Set<number>): number[] {
  return utterances
    .filter((u) => isBargeUtterance(u, bargeBeats) && agentSpeakingAt(sorted, u.atMs))
    .map((u) => {
      const stop = sorted.find((e) => e.kind === 'agent_audio_stop' && e.atMs >= u.atMs && e.atMs <= u.atMs + BARGE_IN_STOP_WINDOW_MS);
      return stop ? stop.atMs - u.atMs : BARGE_IN_STOP_WINDOW_MS;
    });
}

export function scoreTurnTaking(events: EvidenceEvent[]): TurnTakingResult {
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  const utterances = sorted.filter((e): e is Utterance => e.kind === 'caller_utterance');
  const synthetic = utterances.length > 0;
  const bargeBeats = bargeInBeatIndexes(sorted);

  const bargeIns = synthetic
    ? syntheticBargeIns(sorted, utterances, bargeBeats)
    : sorted.flatMap((e) => (e.kind === 'turn_metric' && e.bargeInMs !== null ? [e.bargeInMs] : []));
  const bargeInPass = bargeIns.length ? bargeIns.every((ms) => ms <= BARGE_IN_MAX_MS) : null;

  let talkOverCount = 0;
  if (synthetic) {
    for (const u of utterances) {
      if (isBargeUtterance(u, bargeBeats)) continue;
      const end = u.atMs + u.durationMs;
      talkOverCount += sorted.filter((e) => e.kind === 'agent_audio_start' && e.atMs > u.atMs && e.atMs < end).length;
    }
  } else {
    let callerSpeaking = false;
    for (const event of sorted) {
      if (event.kind === 'caller_speech_start') callerSpeaking = true;
      else if (event.kind === 'caller_speech_stop') callerSpeaking = false;
      else if (event.kind === 'agent_audio_start' && callerSpeaking) talkOverCount += 1;
    }
  }

  // Synthetic runs know the exact caller start; human runs estimate it from the transcript.
  const activityStart = synthetic
    ? (e: EvidenceEvent) => (e.kind === 'caller_utterance' ? e.atMs : null)
    : callerActivityStart;

  const lastEventAt = sorted.length ? sorted[sorted.length - 1].atMs : 0;
  let silenceViolations = 0;
  for (const event of sorted) {
    if (event.kind !== 'agent_transcript') continue;
    const windowEnd = event.atMs + SILENCE_REPROMPT_MS;
    const callerSpokeInWindow = sorted.some((e) => {
      const start = e.atMs > event.atMs ? activityStart(e) : null;
      return start !== null && start <= windowEnd;
    });
    const callContinued = lastEventAt > windowEnd + REPROMPT_GRACE_MS;
    if (callerSpokeInWindow || !callContinued) continue;
    // Any agent speech after the pause counts: a new audio start or the agent simply continuing its turn.
    const reprompted = sorted.some(
      (e) => (e.kind === 'agent_audio_start' || e.kind === 'agent_transcript') && e.atMs > event.atMs + 250 && e.atMs <= windowEnd
    );
    if (!reprompted) silenceViolations += 1;
  }

  const status = !sorted.length
    ? 'no_data'
    : bargeInPass === false || silenceViolations > 0
      ? 'fail'
      : talkOverCount > 0 ? 'warn' : 'pass';
  return { status, bargeIns, bargeInPass, talkOverCount, silenceViolations };
}
```

- [ ] **Step 6: Run the new and existing tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-scoring.test.ts && npm run test:voice-eval`
Expected: PASS. The phase-1 latency and turn-taking tests are unchanged and still pass.

- [ ] **Step 7: Commit and push.**

```bash
git add shared/voice-eval/scoring/latency.ts shared/voice-eval/scoring/turn-taking.ts tests/helpers/voice-eval-fixtures.ts tests/voice-eval-caller-scoring.test.ts
git commit -m "Score synthetic calls from exact caller utterance timings

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 3: Seeded random and turn detector

**Files:**
- Create: `shared/voice-eval/caller/random.ts`
- Create: `shared/voice-eval/caller/turn-detector.ts`
- Test: `tests/voice-eval-caller-turns.test.ts` (create)

**Interfaces:**
- Consumes: `VoiceEvalSignal` from `shared/voice-eval/evidence.ts` (the Task 1 kinds, with an absolute `at`).
- Produces:
  - `seededRandom(seed: string): () => number` (values in `[0, 1)`, deterministic per seed)
  - `type TurnSignal = 'agent_turn_ended' | 'agent_quiet'`
  - `interface TurnDetectorOptions { startedAt: number; gapMs: () => number; quietMs?: number; openingMs?: number; staleToolMs?: number }`
  - `class TurnDetector`:
    - `constructor(options)`
    - `observe(signal: VoiceEvalSignal): void`
    - `callerStarted(at: number): void`
    - `callerEnded(at: number): void`
    - `poll(now: number): TurnSignal | null`

  `poll` returns each signal once. The defaults are `quietMs` 10000, `openingMs` 4000 and `staleToolMs` 30000.

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-turns.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../shared/voice-eval/caller/random.ts';
import { TurnDetector } from '../shared/voice-eval/caller/turn-detector.ts';

const detector = () => new TurnDetector({ startedAt: 0, gapMs: () => 600 });

test('seededRandom is deterministic per seed and stays in [0, 1)', () => {
  const a = seededRandom('run-1');
  const b = seededRandom('run-1');
  const c = seededRandom('run-2');
  const seqA = [a(), a(), a()];
  assert.deepEqual(seqA, [b(), b(), b()]);
  assert.notDeepEqual(seqA, [c(), c(), c()]);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('fires once after the gap when the agent stops speaking', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  assert.equal(d.poll(1500), null);
  d.observe({ kind: 'agent_audio_stop', at: 2000 });
  assert.equal(d.poll(2500), null);
  assert.equal(d.poll(2600), 'agent_turn_ended');
  assert.equal(d.poll(2700), null);
});

test('new agent audio during the gap cancels the turn end', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 2000 });
  d.observe({ kind: 'agent_audio_start', at: 2300 });
  assert.equal(d.poll(2700), null);
  d.observe({ kind: 'agent_audio_stop', at: 3000 });
  assert.equal(d.poll(3600), 'agent_turn_ended');
});

test('a tool call in flight blocks the turn end, and the result requires new agent speech', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 1500 });
  d.observe({ kind: 'tool_call', at: 1700, callId: 't1', name: 'healthcare_patient_access', args: {} });
  assert.equal(d.poll(3000), null);
  d.observe({ kind: 'tool_result', at: 4000, callId: 't1', ok: true, result: {} });
  assert.equal(d.poll(5000), null, 'the pre-tool "one moment" line is not a finished turn');
  d.observe({ kind: 'agent_audio_start', at: 5200 });
  d.observe({ kind: 'agent_audio_stop', at: 7000 });
  assert.equal(d.poll(7600), 'agent_turn_ended');
});

test('quiet fallback fires 10s after a tool result the agent never speaks about', () => {
  const d = detector();
  d.observe({ kind: 'agent_audio_start', at: 1000 });
  d.observe({ kind: 'agent_audio_stop', at: 1500 });
  d.observe({ kind: 'tool_call', at: 1700, callId: 't1', name: 'healthcare_patient_access', args: {} });
  d.observe({ kind: 'tool_result', at: 4000, callId: 't1', ok: true, result: {} });
  assert.equal(d.poll(13900), null);
  assert.equal(d.poll(14000), 'agent_quiet');
  assert.equal(d.poll(14100), null);
  assert.equal(d.poll(24000), 'agent_quiet');
});

test('a tool call that never returns is treated as stale after 30s', () => {
  const d = detector();
  d.observe({ kind: 'tool_call', at: 1000, callId: 't1', name: 'healthcare_patient_access', args: {} });
  assert.equal(d.poll(20000), null);
  assert.equal(d.poll(31000), 'agent_quiet');
});

test('opening fallback fires after 4s when the agent never speaks, but not once it has', () => {
  const silent = detector();
  assert.equal(silent.poll(3900), null);
  assert.equal(silent.poll(4000), 'agent_quiet');
  const greeted = detector();
  greeted.observe({ kind: 'agent_audio_start', at: 500 });
  assert.equal(greeted.poll(4500), null);
});

test('the caller speaking blocks signals; agent speech that ended during the caller turn does not count', () => {
  const d = detector();
  d.callerStarted(1000);
  d.observe({ kind: 'agent_audio_start', at: 1200 });
  d.observe({ kind: 'agent_audio_stop', at: 1400 });
  assert.equal(d.poll(2500), null);
  d.callerEnded(3000);
  assert.equal(d.poll(3700), null, 'the agent blip during caller speech is not a turn');

  const still = detector();
  still.callerStarted(1000);
  still.observe({ kind: 'agent_audio_start', at: 1500 });
  still.callerEnded(2000);
  still.observe({ kind: 'agent_audio_stop', at: 4000 });
  assert.equal(still.poll(4600), 'agent_turn_ended', 'agent still speaking when the caller ended counts');
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-turns.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Implement `random.ts`.** Create `shared/voice-eval/caller/random.ts`:

```ts
/** Deterministic PRNG (string hash → mulberry32) so a run's jitter and noise are reproducible. */
export function seededRandom(seed: string): () => number {
  let hash = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Implement `turn-detector.ts`.** Create `shared/voice-eval/caller/turn-detector.ts`:

```ts
import type { VoiceEvalSignal } from '../evidence.ts';

export type TurnSignal = 'agent_turn_ended' | 'agent_quiet';

export interface TurnDetectorOptions {
  startedAt: number;
  /** Human reply gap, drawn once per agent turn. */
  gapMs: () => number;
  quietMs?: number;
  openingMs?: number;
  staleToolMs?: number;
}

/**
 * Decides when the synthetic caller may speak, from the same signals the scorer reads.
 * An agent turn has ended when the agent stopped speaking, no tool call is in flight,
 * and a human gap has passed with no new agent audio.
 */
export class TurnDetector {
  private agentSpeaking = false;
  private anyAgentActivity = false;
  private agentSpokeSinceCaller = false;
  private emitted = false;
  private callerSpeaking = false;
  private lastAgentActivity: number;
  private lastQuietAnchor: number;
  private currentGap: number;
  private readonly openTools = new Map<string, number>();

  constructor(private readonly options: TurnDetectorOptions) {
    this.lastAgentActivity = options.startedAt;
    this.lastQuietAnchor = options.startedAt;
    this.currentGap = options.gapMs();
  }

  observe(signal: VoiceEvalSignal): void {
    switch (signal.kind) {
      case 'agent_audio_start':
        this.agentSpeaking = true;
        this.anyAgentActivity = true;
        this.agentSpokeSinceCaller = true;
        this.emitted = false;
        this.touch(signal.at);
        break;
      case 'agent_audio_stop':
        if (this.agentSpeaking) this.currentGap = this.options.gapMs();
        this.agentSpeaking = false;
        this.touch(signal.at);
        break;
      case 'tool_call':
        this.openTools.set(signal.callId, signal.at);
        this.anyAgentActivity = true;
        // Speech before a tool call ("one moment") is not the agent's answer.
        this.agentSpokeSinceCaller = this.agentSpeaking;
        this.emitted = false;
        this.touch(signal.at);
        break;
      case 'tool_result':
        this.openTools.delete(signal.callId);
        this.agentSpokeSinceCaller = this.agentSpeaking;
        this.emitted = false;
        this.touch(signal.at);
        break;
      default:
        break;
    }
  }

  callerStarted(_at: number): void {
    this.callerSpeaking = true;
  }

  callerEnded(at: number): void {
    this.callerSpeaking = false;
    // Agent audio that started and stopped under the caller is not a turn to answer.
    this.agentSpokeSinceCaller = this.agentSpeaking;
    this.emitted = false;
    this.lastQuietAnchor = Math.max(this.lastQuietAnchor, at);
  }

  poll(now: number): TurnSignal | null {
    if (this.callerSpeaking || this.agentSpeaking || this.toolsInFlight(now)) return null;
    if (this.agentSpokeSinceCaller && !this.emitted && now - this.lastAgentActivity >= this.currentGap) {
      this.emitted = true;
      this.lastQuietAnchor = now;
      return 'agent_turn_ended';
    }
    const quietMs = this.anyAgentActivity ? this.options.quietMs ?? 10000 : this.options.openingMs ?? 4000;
    if (now - Math.max(this.lastAgentActivity, this.lastQuietAnchor) >= quietMs) {
      this.lastQuietAnchor = now;
      return 'agent_quiet';
    }
    return null;
  }

  private toolsInFlight(now: number): boolean {
    const staleMs = this.options.staleToolMs ?? 30000;
    for (const [callId, at] of this.openTools) if (now - at >= staleMs) this.openTools.delete(callId);
    return this.openTools.size > 0;
  }

  private touch(at: number): void {
    this.lastAgentActivity = Math.max(this.lastAgentActivity, at);
  }
}
```

- [ ] **Step 5: Run the tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-turns.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit and push.**

```bash
git add shared/voice-eval/caller/random.ts shared/voice-eval/caller/turn-detector.ts tests/voice-eval-caller-turns.test.ts
git commit -m "Add the synthetic caller turn detector

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 4: Beat scheduler

**Files:**
- Create: `shared/voice-eval/caller/beat-scheduler.ts`
- Test: `tests/voice-eval-caller-beats.test.ts` (create)

**Interfaces:**
- Consumes:
  - `Beat` (Task 1) and `VoiceEvalSignal`;
  - `HEALTHCARE_TOOL_NAME` from `shared/healthcare-demo.ts`.
- Produces:
  - `type CallerAction = { kind: 'beat'; beatIndex: number; beat: Beat } | { kind: 'silence'; beatIndex: number; durationMs: number } | { kind: 'brain' }`
  - `class BeatScheduler`:
    - `constructor(beats: Beat[])`
    - `observe(signal: VoiceEvalSignal): void`
    - `nextTurnAction(): CallerAction`: called once per caller turn; a beat with `afterTurn = N` is due once N caller turns have been taken and its anchor is met
    - `pollBargeIn(now: number): { beatIndex: number; beat: Beat } | null`
    - `hiddenFacts(): string[]`
    - `firedBeats(): number[]`

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-beats.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatScheduler } from '../shared/voice-eval/caller/beat-scheduler.ts';
import { SCENARIOS, getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

const TOOL = 'healthcare_patient_access';
const scenario = (id: string) => getScenario(id) as Scenario;
function toolOk(s: BeatScheduler, callId: string, action: string, result: unknown = { ok: true }) {
  s.observe({ kind: 'tool_call', at: 0, callId, name: TOOL, args: { action } });
  s.observe({ kind: 'tool_result', at: 1, callId, ok: true, result });
}

test('scenarios without beats always ask the brain', () => {
  const s = new BeatScheduler(scenario('hc-01').beats);
  for (let i = 0; i < 5; i += 1) assert.deepEqual(s.nextTurnAction(), { kind: 'brain' });
});

test('hc-10 says its line on the second caller turn', () => {
  const s = new BeatScheduler(scenario('hc-10').beats);
  assert.equal(s.nextTurnAction().kind, 'brain');
  const second = s.nextTurnAction();
  assert.equal(second.kind, 'beat');
  assert.equal(second.kind === 'beat' && second.beatIndex, 0);
  assert.equal(s.nextTurnAction().kind, 'brain', 'a beat fires once');
  assert.deepEqual(s.firedBeats(), [0]);
});

test('hc-09 goes silent on the third caller turn', () => {
  const s = new BeatScheduler(scenario('hc-09').beats);
  s.nextTurnAction();
  s.nextTurnAction();
  assert.deepEqual(s.nextTurnAction(), { kind: 'silence', beatIndex: 0, durationMs: 12000 });
});

test('hc-05 correction waits for both its turn and a successful search, and hides the fact until then', () => {
  const s = new BeatScheduler(scenario('hc-05').beats);
  assert.deepEqual(s.hiddenFacts(), ['preferredDay']);
  for (let i = 0; i < 4; i += 1) assert.equal(s.nextTurnAction().kind, 'brain');
  toolOk(s, 'a', 'search_availability', { error: 'EHR offline' });
  assert.equal(s.nextTurnAction().kind, 'brain', 'a failed search is not the anchor');
  toolOk(s, 'b', 'search_availability');
  assert.equal(s.nextTurnAction().kind, 'beat');
  assert.deepEqual(s.hiddenFacts(), []);
});

test('hc-06 barge-in arms only after the hold, fires afterAgentSpeechMs into agent audio, once', () => {
  const s = new BeatScheduler(scenario('hc-06').beats);
  s.observe({ kind: 'agent_audio_start', at: 1000 });
  assert.equal(s.pollBargeIn(5000), null, 'not armed before hold_slot');
  toolOk(s, 'h', 'hold_slot');
  s.observe({ kind: 'agent_audio_start', at: 6000 });
  s.observe({ kind: 'agent_audio_stop', at: 6500 });
  assert.equal(s.pollBargeIn(7300), null, 'agent stopped early: cancelled but still armed');
  s.observe({ kind: 'agent_audio_start', at: 8000 });
  assert.equal(s.pollBargeIn(9199), null);
  const fired = s.pollBargeIn(9200);
  assert.equal(fired?.beatIndex, 0);
  s.observe({ kind: 'agent_audio_start', at: 12000 });
  assert.equal(s.pollBargeIn(20000), null, 'fires once');
  assert.equal(s.nextTurnAction().kind, 'brain', 'barge-ins are never turn actions');
});

test('every scenario fires all its turn beats once anchors are met', () => {
  for (const sc of SCENARIOS) {
    const s = new BeatScheduler(sc.beats);
    sc.beats.forEach((beat, i) => { if (beat.anchor) toolOk(s, `c${i}`, beat.anchor.afterTool); });
    for (let i = 0; i < 10; i += 1) s.nextTurnAction();
    const expected = sc.beats.flatMap((beat, i) => (beat.kind === 'barge_in' ? [] : [i]));
    assert.deepEqual(s.firedBeats(), expected, sc.id);
  }
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-beats.test.ts`
Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement.** Create `shared/voice-eval/caller/beat-scheduler.ts`:

```ts
import { HEALTHCARE_TOOL_NAME } from '../../healthcare-demo.ts';
import type { VoiceEvalSignal } from '../evidence.ts';
import type { Beat } from '../types.ts';

export type CallerAction =
  | { kind: 'beat'; beatIndex: number; beat: Beat }
  | { kind: 'silence'; beatIndex: number; durationMs: number }
  | { kind: 'brain' };

function hasError(result: unknown): boolean {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return false;
  const error = (result as Record<string, unknown>).error;
  return error !== undefined && error !== null && error !== false;
}

/** Decides, per caller turn, whether a scripted beat overrides the brain; owns barge-in timing. */
export class BeatScheduler {
  private turnsTaken = 0;
  private readonly fired = new Set<number>();
  private readonly anchorsMet = new Set<string>();
  private readonly toolActions = new Map<string, string>();
  private bargeDue: { beatIndex: number; at: number } | null = null;

  constructor(private readonly beats: Beat[]) {}

  observe(signal: VoiceEvalSignal): void {
    if (signal.kind === 'tool_call' && signal.name === HEALTHCARE_TOOL_NAME) {
      this.toolActions.set(signal.callId, String(signal.args.action ?? ''));
    } else if (signal.kind === 'tool_result' && signal.ok && !hasError(signal.result)) {
      const action = this.toolActions.get(signal.callId);
      if (action) this.anchorsMet.add(action);
    } else if (signal.kind === 'agent_audio_start') {
      const index = this.armedBargeIn();
      if (index !== null) this.bargeDue = { beatIndex: index, at: signal.at + (this.beats[index].afterAgentSpeechMs ?? 0) };
    } else if (signal.kind === 'agent_audio_stop') {
      this.bargeDue = null;
    }
  }

  pollBargeIn(now: number): { beatIndex: number; beat: Beat } | null {
    if (!this.bargeDue || now < this.bargeDue.at) return null;
    const { beatIndex } = this.bargeDue;
    this.bargeDue = null;
    this.fired.add(beatIndex);
    return { beatIndex, beat: this.beats[beatIndex] };
  }

  nextTurnAction(): CallerAction {
    const index = this.beats.findIndex((beat, i) =>
      beat.kind !== 'barge_in' && !this.fired.has(i) && this.turnsTaken >= (beat.afterTurn ?? 0) && this.anchorMet(beat)
    );
    this.turnsTaken += 1;
    if (index === -1) return { kind: 'brain' };
    this.fired.add(index);
    const beat = this.beats[index];
    return beat.kind === 'silence'
      ? { kind: 'silence', beatIndex: index, durationMs: beat.durationMs ?? 0 }
      : { kind: 'beat', beatIndex: index, beat };
  }

  /** Facts the brain must not see yet: the corrected value of a correction that has not fired. */
  hiddenFacts(): string[] {
    return this.beats.flatMap((beat, i) => (beat.kind === 'correction' && beat.correctedFact && !this.fired.has(i) ? [beat.correctedFact] : []));
  }

  firedBeats(): number[] {
    return [...this.fired].sort((a, b) => a - b);
  }

  private anchorMet(beat: Beat): boolean {
    return !beat.anchor || this.anchorsMet.has(beat.anchor.afterTool);
  }

  private armedBargeIn(): number | null {
    const index = this.beats.findIndex((beat, i) => beat.kind === 'barge_in' && !this.fired.has(i) && this.anchorMet(beat));
    return index === -1 ? null : index;
  }
}
```

- [ ] **Step 4: Run the tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-beats.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit and push.**

```bash
git add shared/voice-eval/caller/beat-scheduler.ts tests/voice-eval-caller-beats.test.ts
git commit -m "Add the synthetic caller beat scheduler

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 5: Caller brain prompt and decision parser

**Files:**
- Create: `shared/voice-eval/caller/brain-prompt.ts`
- Test: `tests/voice-eval-caller-brain.test.ts` (create)

**Interfaces:**
- Consumes: `Scenario`.
- Produces:
  - `interface TranscriptTurn { role: 'agent' | 'caller'; text: string }`
  - `interface BrainRequest { instructions: string; input: string }`
  - `type BrainDecision = { action: 'say' | 'hang_up'; text: string }`
  - `BRAIN_OUTPUT_SCHEMA` (a JSON schema object)
  - `buildBrainRequest(scenario: Scenario, transcript: TranscriptTurn[], hiddenFacts: string[]): BrainRequest`
  - `parseBrainDecision(raw: string): BrainDecision`: throws `Error` on invalid output
  - `MAX_TRANSCRIPT_TURNS = 60`, `MAX_TURN_CHARS = 1000`, `MAX_LINE_CHARS = 400`

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-brain.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrainRequest, MAX_LINE_CHARS, parseBrainDecision } from '../shared/voice-eval/caller/brain-prompt.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

const hc05 = getScenario('hc-05') as Scenario;

test('brain request carries persona, goal and visible facts but hides pending correction facts', () => {
  const hidden = buildBrainRequest(hc05, [], ['preferredDay']);
  assert.match(hidden.instructions, /calm/);
  assert.match(hidden.instructions, /First ask for Tuesday/);
  assert.match(hidden.instructions, /dob: 1988-02-14/);
  assert.doesNotMatch(hidden.instructions, /preferredDay:/);
  const shown = buildBrainRequest(hc05, [], []);
  assert.match(shown.instructions, /preferredDay: Thursday/);
});

test('an empty transcript says the call just connected', () => {
  assert.match(buildBrainRequest(hc05, [], []).input, /just connected/);
});

test('transcript is rendered as Agent/You lines, keeps the last 60 turns, and clamps long turns', () => {
  const turns = Array.from({ length: 70 }, (_, i) => ({ role: i % 2 ? 'caller' as const : 'agent' as const, text: `turn ${i}` }));
  turns[69] = { role: 'caller', text: 'x'.repeat(5000) };
  const { input } = buildBrainRequest(hc05, turns, []);
  assert.doesNotMatch(input, /turn 9\b/);
  assert.match(input, /Agent: turn 10/);
  assert.match(input, /You: turn 11/);
  assert.ok(!input.includes('x'.repeat(1001)));
});

test('parseBrainDecision accepts say and hang_up, rejects bad output, clamps long lines', () => {
  assert.deepEqual(parseBrainDecision('{"action":"say","text":" Hi there. "}'), { action: 'say', text: 'Hi there.' });
  assert.deepEqual(parseBrainDecision('{"action":"hang_up","text":""}'), { action: 'hang_up', text: '' });
  assert.throws(() => parseBrainDecision('{"action":"say","text":"  "}'), /empty/);
  assert.throws(() => parseBrainDecision('{"action":"dance","text":"x"}'), /action/);
  assert.throws(() => parseBrainDecision('not json'), /JSON/);
  assert.equal(parseBrainDecision(JSON.stringify({ action: 'say', text: 'y'.repeat(900) })).text.length, MAX_LINE_CHARS);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-brain.test.ts`
Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement.** Create `shared/voice-eval/caller/brain-prompt.ts`:

```ts
import type { Scenario } from '../types.ts';

export interface TranscriptTurn { role: 'agent' | 'caller'; text: string }
export interface BrainRequest { instructions: string; input: string }
export type BrainDecision = { action: 'say' | 'hang_up'; text: string };

export const MAX_TRANSCRIPT_TURNS = 60;
export const MAX_TURN_CHARS = 1000;
export const MAX_LINE_CHARS = 400;

export const BRAIN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'text'],
  properties: {
    action: { type: 'string', enum: ['say', 'hang_up'] },
    text: { type: 'string' }
  }
} as const;

export function buildBrainRequest(scenario: Scenario, transcript: TranscriptTurn[], hiddenFacts: string[]): BrainRequest {
  const hidden = new Set(hiddenFacts);
  const facts = Object.entries(scenario.facts)
    .filter(([key]) => !hidden.has(key))
    .map(([key, fact]) => `- ${key}: ${fact.value}`)
    .join('\n');
  const instructions = [
    "You are role-playing a patient phoning a hospital's patient-access line. You are the CALLER, never the agent.",
    `Persona: temperament ${scenario.persona.temperament}; accent ${scenario.persona.accent}.`,
    `Your goal: ${scenario.goal}`,
    'Your details (give each one only when the agent asks for it):',
    facts,
    'Rules:',
    '- Speak like a real phone caller: one or two short sentences, plain words, no lists or markup.',
    '- Say dates the way a person would (for example "February 14th, 1988").',
    "- Never invent details that are not listed above. If asked for something you don't have, say so.",
    '- Choose action "hang_up" once your goal is done and the agent has wrapped up, when the agent says goodbye, or when the agent hands you to staff. Put a short goodbye in text, or leave it empty.',
    '- Otherwise choose action "say" and put your next line in text.'
  ].join('\n');

  const lines = transcript
    .slice(-MAX_TRANSCRIPT_TURNS)
    .map((turn) => `${turn.role === 'agent' ? 'Agent' : 'You'}: ${turn.text.slice(0, MAX_TURN_CHARS)}`);
  const input = lines.length
    ? `Conversation so far:\n${lines.join('\n')}\n\nWhat do you say next?`
    : '(The call has just connected. The agent has not spoken yet.) What do you say first?';
  return { instructions, input };
}

export function parseBrainDecision(raw: string): BrainDecision {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Caller brain returned invalid JSON');
  }
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const action = record.action;
  if (action !== 'say' && action !== 'hang_up') throw new Error(`Caller brain returned an unknown action: ${String(action)}`);
  const text = typeof record.text === 'string' ? record.text.trim().slice(0, MAX_LINE_CHARS) : '';
  if (action === 'say' && !text) throw new Error('Caller brain returned an empty line');
  return { action, text };
}
```

- [ ] **Step 4: Run the tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-brain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit and push.**

```bash
git add shared/voice-eval/caller/brain-prompt.ts tests/voice-eval-caller-brain.test.ts
git commit -m "Add the synthetic caller brain prompt and decision parser

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 6: `voice-eval-caller` server handler and Edge Function

**Files:**
- Create: `shared/voice-eval/caller/server.ts`
- Create: `supabase/functions/voice-eval-caller/index.ts`
- Test: `tests/voice-eval-caller-server.test.ts` (create)

**Interfaces:**
- Consumes:
  - `getScenario`;
  - `buildBrainRequest`, `parseBrainDecision` and `TranscriptTurn` (Task 5).
- Produces:
  - `interface CallerRun { id: string; scenario_id: string; status: string; agent_config_id: string | null }`
  - `interface CallerDeps`:
    - `loadRun(ownerId, runId): Promise<CallerRun | null>`
    - `resolveElevenLabsKey(ownerId, agentConfigId): Promise<string | null>`
    - `brain(request: BrainRequest): Promise<string>`
    - `tts(apiKey, voiceId, text): Promise<Uint8Array>`
  - `handleCallerRequest(deps, ownerId, body): Promise<{ status: number; body: Record<string, unknown> }>`
  - `bytesToBase64(bytes: Uint8Array): string`
  - Wire responses:
    - `render` → `{ lines: [{ beat_index, text, audio_b64 }] }`
    - `next_turn` → `{ action, text, audio_b64: string | null }`
    - errors → `{ error }` with status 400, 404, 409 or 502.

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-server.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCallerRequest, type CallerDeps, type CallerRun } from '../shared/voice-eval/caller/server.ts';

const RUN_ID = '11111111-2222-3333-4444-555555555555';

function deps(overrides: Partial<CallerDeps> = {}, run: CallerRun | null = { id: RUN_ID, scenario_id: 'hc-06', status: 'running', agent_config_id: null }) {
  const calls = { brain: [] as { instructions: string; input: string }[], tts: [] as { voiceId: string; text: string }[] };
  const base: CallerDeps = {
    loadRun: async () => run,
    resolveElevenLabsKey: async () => 'el-key',
    brain: async (request) => { calls.brain.push(request); return '{"action":"say","text":"Hi, I need to book."}'; },
    tts: async (_key, voiceId, text) => { calls.tts.push({ voiceId, text }); return new Uint8Array([1, 2, 3, 4]); }
  };
  return { deps: { ...base, ...overrides }, calls };
}

test('rejects missing runs, closed runs and unknown actions', async () => {
  assert.equal((await handleCallerRequest(deps({}, null).deps, 'owner', { action: 'render', run_id: RUN_ID })).status, 404);
  const closed = deps({}, { id: RUN_ID, scenario_id: 'hc-06', status: 'scoring', agent_config_id: null });
  assert.equal((await handleCallerRequest(closed.deps, 'owner', { action: 'render', run_id: RUN_ID })).status, 409);
  assert.equal((await handleCallerRequest(deps().deps, 'owner', { action: 'render', run_id: 'nope' })).status, 404);
  assert.equal((await handleCallerRequest(deps().deps, 'owner', { action: 'sing', run_id: RUN_ID })).status, 400);
});

test('render voices every beat line with the persona voice', async () => {
  const { deps: d, calls } = deps();
  const response = await handleCallerRequest(d, 'owner', { action: 'render', run_id: RUN_ID });
  assert.equal(response.status, 200);
  const lines = response.body.lines as { beat_index: number; text: string; audio_b64: string }[];
  assert.equal(lines.length, 1);
  assert.equal(lines[0].beat_index, 0);
  assert.equal(lines[0].text, 'Sorry — can we do the afternoon one instead?');
  assert.deepEqual([...Buffer.from(lines[0].audio_b64, 'base64')], [1, 2, 3, 4]);
  assert.equal(calls.tts[0].voiceId, 'TxGEqnHWrfWFTfGW9XjX');
});

test('render fails clearly without an ElevenLabs key', async () => {
  const response = await handleCallerRequest(deps({ resolveElevenLabsKey: async () => null }).deps, 'owner', { action: 'render', run_id: RUN_ID });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'No ElevenLabs key for the synthetic caller');
});

test('next_turn returns the brain line with audio and hides pending correction facts', async () => {
  const hc05 = { id: RUN_ID, scenario_id: 'hc-05', status: 'running', agent_config_id: null };
  const { deps: d, calls } = deps({}, hc05);
  const response = await handleCallerRequest(d, 'owner', {
    action: 'next_turn', run_id: RUN_ID,
    transcript: [{ role: 'agent', text: 'How can I help?' }, { role: 'robot', text: 'drop me' }, 'junk'],
    beats_fired: []
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.action, 'say');
  assert.equal(response.body.text, 'Hi, I need to book.');
  assert.equal(typeof response.body.audio_b64, 'string');
  assert.doesNotMatch(calls.brain[0].instructions, /preferredDay:/);
  assert.match(calls.brain[0].input, /Agent: How can I help\?/);
  assert.doesNotMatch(calls.brain[0].input, /drop me/);

  await handleCallerRequest(d, 'owner', { action: 'next_turn', run_id: RUN_ID, transcript: [], beats_fired: [0, 'x', 99] });
  assert.match(calls.brain[1].instructions, /preferredDay: Thursday/);
});

test('hang_up with no text skips TTS; brain or TTS failures are 502', async () => {
  const quiet = deps({ brain: async () => '{"action":"hang_up","text":""}' });
  const bye = await handleCallerRequest(quiet.deps, 'owner', { action: 'next_turn', run_id: RUN_ID, transcript: [] });
  assert.deepEqual(bye.body, { action: 'hang_up', text: '', audio_b64: null });
  assert.equal(quiet.calls.tts.length, 0);
  assert.equal((await handleCallerRequest(deps({ brain: async () => 'garbage' }).deps, 'owner', { action: 'next_turn', run_id: RUN_ID })).status, 502);
  assert.equal((await handleCallerRequest(deps({ tts: async () => { throw new Error('quota'); } }).deps, 'owner', { action: 'next_turn', run_id: RUN_ID })).status, 502);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-server.test.ts`
Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement the handler.** Create `shared/voice-eval/caller/server.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-server.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the Edge Function wiring.** Create `supabase/functions/voice-eval-caller/index.ts`. It follows `supabase/functions/voice-eval/index.ts` for auth and `responses-chat` for the OpenAI call:

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { OPENAI_MODELS } from '../../../shared/openai-models.ts';
import { BRAIN_OUTPUT_SCHEMA, type BrainRequest } from '../../../shared/voice-eval/caller/brain-prompt.ts';
import { handleCallerRequest, type CallerDeps } from '../../../shared/voice-eval/caller/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const OPENAI_BASE_URL = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
const ELEVENLABS_BASE_URL = (Deno.env.get('ELEVENLABS_BASE_URL') || 'https://api.elevenlabs.io').replace(/\/+$/, '').replace(/\/v1$/, '');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service role credentials are missing');
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function decodeKey(encrypted: string | null | undefined): string | null {
  try {
    const value = atob(encrypted || '').trim();
    return value || null;
  } catch {
    return null;
  }
}

function outputText(json: Record<string, any>): string {
  if (typeof json.output_text === 'string') return json.output_text;
  return (Array.isArray(json.output) ? json.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((content: any) => content?.type === 'output_text')
    .map((content: any) => (typeof content.text === 'string' ? content.text : ''))
    .join('');
}

const deps: CallerDeps = {
  async loadRun(ownerId, runId) {
    const { data } = await adminClient
      .from('voice_eval_runs')
      .select('id, scenario_id, status, agent_config_id')
      .eq('id', runId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    return data;
  },
  async resolveElevenLabsKey(ownerId, agentConfigId) {
    if (agentConfigId) {
      const { data: config } = await adminClient
        .from('va_agent_configs')
        .select('voice_provider_key_id')
        .eq('id', agentConfigId)
        .eq('user_id', ownerId)
        .maybeSingle();
      if (config?.voice_provider_key_id) {
        const { data: key } = await adminClient
          .from('va_provider_keys')
          .select('encrypted_key')
          .eq('id', config.voice_provider_key_id)
          .eq('provider', 'elevenlabs')
          .maybeSingle();
        const value = decodeKey(key?.encrypted_key);
        if (value) return value;
      }
    }
    const { data: fallback } = await adminClient
      .from('va_provider_keys')
      .select('encrypted_key')
      .eq('user_id', ownerId)
      .eq('provider', 'elevenlabs')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return decodeKey(fallback?.encrypted_key);
  },
  async brain(request: BrainRequest) {
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: OPENAI_MODELS.chat.mini,
        instructions: request.instructions,
        input: [{ role: 'user', content: request.input }],
        reasoning: { effort: 'none' },
        text: { format: { type: 'json_schema', name: 'caller_turn', strict: true, schema: BRAIN_OUTPUT_SCHEMA } },
        max_output_tokens: 200,
        store: false
      })
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(json?.error?.message || `OpenAI request failed (${response.status})`);
    return outputText(json);
  },
  async tts(apiKey, voiceId, text) {
    const response = await fetch(`${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
      body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  try {
    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return jsonResponse({ error: 'Authentication required' }, 401);
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return jsonResponse({ error: 'Invalid session' }, 401);
    const { data: vaUser } = await adminClient.from('va_users').select('id').eq('auth_user_id', authData.user.id).maybeSingle();
    if (!vaUser) return jsonResponse({ error: 'User profile not found' }, 403);
    const body = await req.json().catch(() => ({}));
    const result = await handleCallerRequest(deps, vaUser.id, body && typeof body === 'object' ? body : {});
    if (result.status >= 500) console.error('[voice-eval-caller]', result.body.error);
    return jsonResponse(result.body, result.status);
  } catch (error) {
    console.error('[voice-eval-caller]', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Synthetic caller failed' }, 500);
  }
});
```

- [ ] **Step 6: Check that the function bundles.**

Run: `npx esbuild supabase/functions/voice-eval-caller/index.ts --bundle --platform=neutral --format=esm --external:npm:* --outfile=/dev/null`
Expected: no errors. This proves the relative `shared/` imports resolve; deployment happens in Task 11.

- [ ] **Step 7: Commit and push.**

```bash
git add shared/voice-eval/caller/server.ts supabase/functions/voice-eval-caller/index.ts tests/voice-eval-caller-server.test.ts
git commit -m "Add the voice-eval-caller function for caller brain and TTS

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 7: Caller types, PCM decoding, noise beds and the synthetic mic

**Files:**
- Create: `src/lib/voice-eval/synthetic-caller/types.ts`
- Create: `src/lib/voice-eval/synthetic-caller/pcm.ts`
- Create: `src/lib/voice-eval/synthetic-caller/noise.ts`
- Create: `src/lib/voice-eval/synthetic-caller/synthetic-mic.ts`
- Test: `tests/voice-eval-caller-audio.test.ts` (create)

**Interfaces:**
- Consumes:
  - `seededRandom` (Task 3);
  - `TranscriptTurn` (Task 5);
  - `Scenario['persona']['noise']`.
- Produces, in `types.ts`:
  - `interface CallerSource { start(): Promise<void>; stop(): Promise<void> }`
  - `interface MicLike { readonly track: MediaStreamTrack; play(samples: Float32Array): Promise<{ startedAt: number; endedAt: number }>; stopPlayback(): void; close(): Promise<void> }`. `play` must resolve even when `stopPlayback` interrupts it.
  - `interface RenderedLine { beatIndex: number; text: string; audioB64: string }`
  - `interface NextTurnResult { action: 'say' | 'hang_up'; text: string; audioB64: string | null }`
  - `interface CallerApi { renderBeats(runId: string): Promise<RenderedLine[]>; nextTurn(input: { runId: string; transcript: TranscriptTurn[]; beatsFired: number[] }): Promise<NextTurnResult> }`
  - `class CallerRunClosedError extends Error`
- Also produces:
  - `decodePcm16Base64(b64: string): Float32Array` (`pcm.ts`)
  - `NOISE_RMS = 0.03`, `type NoiseBedKind = 'cafe' | 'car'`, and `generateNoiseBed(kind, seed, sampleRate = 24000, seconds = 8): Float32Array` (`noise.ts`)
  - `createSyntheticMic(noise: Scenario['persona']['noise'], seed: string): Promise<MicLike>` (`synthetic-mic.ts`)

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-audio.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePcm16Base64 } from '../src/lib/voice-eval/synthetic-caller/pcm.ts';
import { generateNoiseBed, NOISE_RMS } from '../src/lib/voice-eval/synthetic-caller/noise.ts';

const rms = (x: Float32Array) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / x.length);

test('decodes little-endian PCM16 base64 into floats', () => {
  const b64 = Buffer.from(new Int16Array([0, 16384, -32768, 32767]).buffer).toString('base64');
  const out = decodePcm16Base64(b64);
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0.5);
  assert.equal(out[2], -1);
  assert.ok(Math.abs(out[3] - 0.99997) < 1e-4);
});

test('noise beds are deterministic per seed, the right length, and normalised', () => {
  for (const kind of ['cafe', 'car'] as const) {
    const a = generateNoiseBed(kind, 'run-1', 24000, 2);
    const b = generateNoiseBed(kind, 'run-1', 24000, 2);
    const c = generateNoiseBed(kind, 'run-2', 24000, 2);
    assert.equal(a.length, 48000);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
    assert.ok(Math.abs(rms(a) - NOISE_RMS) < 0.002, `${kind} rms ${rms(a)}`);
    assert.ok(a.every((v) => Math.abs(v) <= 1));
  }
});

test('café noise has clatter transients well above its RMS', () => {
  const cafe = generateNoiseBed('cafe', 'run-1', 24000, 4);
  const peak = cafe.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
  assert.ok(peak > 4 * rms(cafe), `peak ${peak}`);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-audio.test.ts`
Expected: FAIL, because the modules can't be found.

- [ ] **Step 3: Implement `types.ts`.** Create `src/lib/voice-eval/synthetic-caller/types.ts`:

```ts
import type { TranscriptTurn } from '../../../../shared/voice-eval/caller/brain-prompt.ts';

export interface CallerSource {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MicLike {
  readonly track: MediaStreamTrack;
  /** Plays one utterance; resolves with performance.now() times, also when stopPlayback() cuts it short. */
  play(samples: Float32Array): Promise<{ startedAt: number; endedAt: number }>;
  stopPlayback(): void;
  close(): Promise<void>;
}

export interface RenderedLine { beatIndex: number; text: string; audioB64: string }
export interface NextTurnResult { action: 'say' | 'hang_up'; text: string; audioB64: string | null }

export interface CallerApi {
  renderBeats(runId: string): Promise<RenderedLine[]>;
  nextTurn(input: { runId: string; transcript: TranscriptTurn[]; beatsFired: number[] }): Promise<NextTurnResult>;
}

/** The eval run is no longer running (it is being scored or was aborted); the caller should stop quietly. */
export class CallerRunClosedError extends Error {}
```

- [ ] **Step 4: Implement `pcm.ts`.** Create `src/lib/voice-eval/synthetic-caller/pcm.ts`:

```ts
/** ElevenLabs pcm_24000 is 16-bit little-endian mono. */
export function decodePcm16Base64(b64: string): Float32Array {
  const binary = atob(b64);
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) view.setUint8(i, binary.charCodeAt(i));
  const out = new Float32Array(Math.floor(binary.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
```

- [ ] **Step 5: Implement `noise.ts`.** Create `src/lib/voice-eval/synthetic-caller/noise.ts`:

```ts
import { seededRandom } from '../../../../shared/voice-eval/caller/random.ts';

/** Noise RMS that sits roughly 10 dB under typical TTS speech. */
export const NOISE_RMS = 0.03;
export type NoiseBedKind = 'cafe' | 'car';

export function generateNoiseBed(kind: NoiseBedKind, seed: string, sampleRate = 24000, seconds = 8): Float32Array {
  const random = seededRandom(`${kind}:${seed}`);
  const white = () => random() * 2 - 1;
  const out = new Float32Array(Math.round(sampleRate * seconds));

  if (kind === 'car') {
    // Low rumble: brown noise through a one-pole low-pass.
    let brown = 0;
    let low = 0;
    for (let i = 0; i < out.length; i += 1) {
      brown = (brown + 0.02 * white()) / 1.02;
      low += 0.05 * (brown - low);
      out[i] = low;
    }
  } else {
    // Café: pink-noise room tone, a swelling low murmur, and short cutlery/cup clatters.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let murmur = 0;
    const phase = random() * Math.PI * 2;
    const clatterLength = Math.round(sampleRate * 0.03);
    let nextClatter = Math.round(sampleRate * (0.4 + random() * 1.1));
    let clatterLeft = 0;
    let clatterGain = 0;
    for (let i = 0; i < out.length; i += 1) {
      const w = white();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.05;
      murmur += 0.08 * (white() - murmur);
      const swell = 0.5 + 0.35 * Math.sin(phase + (2 * Math.PI * 0.4 * i) / sampleRate);
      let sample = pink * 0.6 + murmur * swell;
      if (i >= nextClatter) {
        clatterLeft = clatterLength;
        clatterGain = 0.6 + random() * 0.6;
        nextClatter = i + Math.round(sampleRate * (0.4 + random() * 1.1));
      }
      if (clatterLeft > 0) {
        sample += white() * clatterGain * (clatterLeft / clatterLength);
        clatterLeft -= 1;
      }
      out[i] = sample;
    }
  }

  const current = Math.sqrt(out.reduce((sum, v) => sum + v * v, 0) / out.length) || 1;
  const gain = NOISE_RMS / current;
  for (let i = 0; i < out.length; i += 1) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
  return out;
}
```

- [ ] **Step 6: Run the tests.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-audio.test.ts`
Expected: PASS (3 tests). If the café peak assertion fails, raise the clatter gain range (the `0.6 + random() * 0.6` term), not the test threshold.

- [ ] **Step 7: Implement the WebAudio mic.** Create `src/lib/voice-eval/synthetic-caller/synthetic-mic.ts`. It is browser-only; Task 11 verifies it manually.

```ts
import type { Scenario } from '../../../../shared/voice-eval/types.ts';
import { generateNoiseBed } from './noise.ts';
import type { MicLike } from './types.ts';

const SAMPLE_RATE = 24000;
const START_LEAD_S = 0.05;

function distortionCurve(amount: number): Float32Array {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i * 2) / curve.length - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

/** A persistent mic track: silence by default, caller utterances on demand, and a looped noise bed. */
export async function createSyntheticMic(noise: Scenario['persona']['noise'], seed: string): Promise<MicLike> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  if (context.state === 'suspended') await context.resume().catch(() => undefined);
  if (context.state === 'suspended') {
    await context.close();
    throw new Error('Browser audio is suspended; click the page and start the eval again.');
  }
  const destination = context.createMediaStreamDestination();
  const voiceBus = context.createGain();

  if (noise === 'speakerphone') {
    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 300;
    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 3400;
    const shaper = context.createWaveShaper();
    shaper.curve = distortionCurve(4);
    voiceBus.connect(highPass).connect(lowPass).connect(shaper).connect(destination);
  } else {
    voiceBus.connect(destination);
  }

  let noiseSource: AudioBufferSourceNode | null = null;
  if (noise === 'cafe' || noise === 'car') {
    const samples = generateNoiseBed(noise, seed, SAMPLE_RATE);
    const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;
    noiseSource.connect(destination);
    noiseSource.start();
  }

  const track = destination.stream.getAudioTracks()[0];
  let current: { source: AudioBufferSourceNode; finish: () => void } | null = null;

  return {
    track,
    play(samples) {
      const buffer = context.createBuffer(1, Math.max(1, samples.length), SAMPLE_RATE);
      buffer.copyToChannel(samples, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(voiceBus);
      const startedAt = performance.now() + START_LEAD_S * 1000;
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          if (current?.source === source) current = null;
          resolve({ startedAt, endedAt: performance.now() });
        };
        source.onended = finish;
        current = { source, finish };
        source.start(context.currentTime + START_LEAD_S);
      });
    },
    stopPlayback() {
      const playing = current;
      if (!playing) return;
      try {
        playing.source.stop();
      } catch {
        // Already stopped.
      }
      playing.finish();
    },
    async close() {
      this.stopPlayback();
      try {
        noiseSource?.stop();
      } catch {
        // Already stopped.
      }
      track.stop();
      await context.close().catch(() => undefined);
    }
  };
}
```

- [ ] **Step 8: Type-check.**

Run: `npm run typecheck`
Expected: no new errors. Any new error from these files must be fixed before committing.

- [ ] **Step 9: Commit and push.**

```bash
git add src/lib/voice-eval/synthetic-caller/types.ts src/lib/voice-eval/synthetic-caller/pcm.ts src/lib/voice-eval/synthetic-caller/noise.ts src/lib/voice-eval/synthetic-caller/synthetic-mic.ts tests/voice-eval-caller-audio.test.ts
git commit -m "Add synthetic mic, PCM decoding and procedural noise beds

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 8: Adapter `attachSyntheticInput` / `detachSyntheticInput`

**Files:**
- Create: `src/lib/voice-eval/synthetic-input.ts`
- Modify: `src/lib/voice-adapters/types.ts`
- Modify: `src/lib/realtime-client.ts` (fields near the other private fields; `sendAudio` at about line 1014; `disconnect()` near `this.dataChannel?.close();`)
- Modify: `src/lib/voice-adapters/elevenlabs-adapter.ts` (next to `injectAudio`, about line 150)
- Test: `tests/voice-eval-caller-adapter.test.ts` (create)

**Interfaces:**
- Produces:
  - `VoiceAdapter.attachSyntheticInput?: (track: MediaStreamTrack) => Promise<void>`
  - `VoiceAdapter.detachSyntheticInput?: () => Promise<void>`
  - `startPcmPump(track, onFrame: (pcm: Int16Array) => void): Promise<() => void>`
- Behaviour:
  - While a synthetic track is attached, the public `sendAudio` ignores real-mic frames.
  - Attaching twice rejects with `A synthetic caller is already attached`.
  - A WebRTC client with no audio sender rejects with `No audio sender to attach the synthetic caller to`.

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-adapter.test.ts`. It follows the esbuild harness in `tests/live-voice.test.ts` around line 270:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function loadClient() {
  const built = await build({
    entryPoints: ['src/lib/realtime-client.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
    plugins: [{ name: 'browser-boundaries', setup(builder) {
      builder.onResolve({ filter: /(?:tools-registry|audio-manager|benchmark-instrumentation|benchmark-audio-store|synthetic-input)$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const getToolSchemas=()=>[]; export const getAudioManager=()=>({}); export const beginBenchmarkTurn=()=>{}; export const emitBenchmarkEvent=()=>{}; export const emitBenchmarkMilestone=()=>{}; export const getBenchmarkTrace=()=>null; export const recordBenchmarkWaveform=()=>{}; export const saveBenchmarkOutputAudio=async()=>{}; export const startPcmPump=(...args)=>globalThis.syntheticPumpStart(...args);' }));
    } }]
  });
  (globalThis as any).window = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const { RealtimeAPIClient } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
  return RealtimeAPIClient;
}

test('WebRTC: attach replaces the audio sender track for the call and detach restores the mic', async () => {
  const RealtimeAPIClient = await loadClient();
  const client = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { webrtc: { sessionUrl: 'https://test.invalid' } });
  const mic = { kind: 'audio', id: 'mic' };
  const synthetic = { kind: 'audio', id: 'synthetic' };
  const sender = { track: mic as any, replaceTrack: async (t: any) => { sender.track = t; } };
  client.peerConnection = { getSenders: () => [sender] };
  client.mediaStream = { getAudioTracks: () => [mic], getTracks: () => [mic] };

  await client.attachSyntheticInput(synthetic);
  assert.equal(sender.track, synthetic);
  await assert.rejects(client.attachSyntheticInput(synthetic), /already attached/);
  await client.detachSyntheticInput();
  assert.equal(sender.track, mic);
  await client.detachSyntheticInput();

  const bare = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { webrtc: { sessionUrl: 'https://test.invalid' } });
  bare.peerConnection = { getSenders: () => [] };
  await assert.rejects(bare.attachSyntheticInput(synthetic), /No audio sender/);
});

test('WebSocket: attach pumps synthetic frames and gates real-mic frames until detach', async () => {
  const RealtimeAPIClient = await loadClient();
  const pump: { onFrame?: (pcm: Int16Array) => void; stopped: boolean } = { stopped: false };
  (globalThis as any).syntheticPumpStart = async (_track: unknown, onFrame: (pcm: Int16Array) => void) => {
    pump.onFrame = onFrame;
    return () => { pump.stopped = true; };
  };
  const client = new RealtimeAPIClient({ model: 'test', instructions: 'x', voice: 'marin' }, { apiKey: 'k' });
  const sent: any[] = [];
  client.ws = { readyState: WebSocket.OPEN, send: (text: string) => sent.push(JSON.parse(text)) };

  await client.attachSyntheticInput({ kind: 'audio' });
  client.sendAudio(new Int16Array(2400));
  assert.equal(sent.length, 0, 'real mic frames are ignored while synthetic input is attached');
  pump.onFrame?.(new Int16Array(2400));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'input_audio_buffer.append');

  await client.detachSyntheticInput();
  assert.equal(pump.stopped, true);
  client.sendAudio(new Int16Array(2400));
  assert.equal(sent.length, 2);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-adapter.test.ts`
Expected: FAIL with `client.attachSyntheticInput is not a function`.

- [ ] **Step 3: Implement the pump.** Create `src/lib/voice-eval/synthetic-input.ts`:

```ts
/** Streams a MediaStreamTrack as 24 kHz PCM16 frames via the existing pcm-downsampler worklet (WebSocket transport). */
export async function startPcmPump(track: MediaStreamTrack, onFrame: (pcm: Int16Array) => void): Promise<() => void> {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    await context.audioWorklet.addModule(new URL('/audio-worklet-processor.js', window.location.origin).toString());
    const source = context.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(context, 'pcm-downsampler', { processorOptions: { targetSampleRate: 24000 } });
    node.port.onmessage = (event: MessageEvent<Int16Array>) => onFrame(event.data);
    source.connect(node);
    if (context.state === 'suspended') await context.resume();
    return () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      void context.close();
    };
  } catch (error) {
    void context.close();
    throw error;
  }
}
```

- [ ] **Step 4: Extend the adapter interface.** In `src/lib/voice-adapters/types.ts`, add these after `injectAudio?`:

```ts
  /** Replaces the microphone with a synthetic caller track for the whole call. */
  attachSyntheticInput?: (track: MediaStreamTrack) => Promise<void>;
  /** Restores the microphone. Safe to call when nothing is attached. */
  detachSyntheticInput?: () => Promise<void>;
```

- [ ] **Step 5: Implement in `RealtimeAPIClient`.** In `src/lib/realtime-client.ts`:
  1. Add the import next to the other `./` imports:

```ts
import { startPcmPump } from './voice-eval/synthetic-input';
```

  2. Add two fields next to `private mediaStream: MediaStream | null = null;`:

```ts
  private syntheticTrack: MediaStreamTrack | null = null;
  private stopSyntheticPump: (() => void) | null = null;
```

  3. Replace `sendAudio(audioData: Int16Array): void {` and its body with a gate plus a private frame sender. The frame sender's body is the original body, unchanged:

```ts
  sendAudio(audioData: Int16Array): void {
    // While a synthetic caller is attached, only its pump may send audio.
    if (this.syntheticTrack) return;
    this.sendAudioFrame(audioData);
  }

  private sendAudioFrame(audioData: Int16Array): void {
    if (this.webrtc) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const base64Audio = this.arrayBufferToBase64(audioData.buffer);
    this.hasBufferedAudio = true;
    this.bufferedSamples += audioData.length;
    this.hasReceivedAudio = true;
    this.send({
      type: 'input_audio_buffer.append',
      audio: base64Audio
    });
  }

  async attachSyntheticInput(track: MediaStreamTrack): Promise<void> {
    if (this.syntheticTrack) throw new Error('A synthetic caller is already attached');
    if (this.webrtc) {
      const sender = this.peerConnection?.getSenders().find((item) => item.track?.kind === 'audio');
      if (!sender) throw new Error('No audio sender to attach the synthetic caller to');
      await sender.replaceTrack(track);
      this.syntheticTrack = track;
      return;
    }
    this.syntheticTrack = track;
    try {
      this.stopSyntheticPump = await startPcmPump(track, (pcm) => this.sendAudioFrame(pcm));
    } catch (error) {
      this.syntheticTrack = null;
      throw error;
    }
  }

  async detachSyntheticInput(): Promise<void> {
    const track = this.syntheticTrack;
    if (!track) return;
    this.syntheticTrack = null;
    this.stopSyntheticPump?.();
    this.stopSyntheticPump = null;
    if (this.webrtc) {
      const sender = this.peerConnection?.getSenders().find((item) => item.track === track);
      await sender?.replaceTrack(this.mediaStream?.getAudioTracks()[0] ?? null);
    }
  }
```

  4. In `disconnect()`, immediately before `this.dataChannel?.close();`, add:

```ts
    this.stopSyntheticPump?.();
    this.stopSyntheticPump = null;
    this.syntheticTrack = null;
```

- [ ] **Step 6: Delegate from `ElevenLabsAdapter`.** In `src/lib/voice-adapters/elevenlabs-adapter.ts`, add these after the `injectAudio` method:

```ts
  attachSyntheticInput(track: MediaStreamTrack): Promise<void> {
    return this.realtime.attachSyntheticInput(track);
  }

  detachSyntheticInput(): Promise<void> {
    return this.realtime.detachSyntheticInput();
  }
```

- [ ] **Step 7: Run the adapter tests, the existing voice tests and the type check.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-adapter.test.ts && npm run test:voice && npm run typecheck`
Expected: PASS, with no new type errors.

- [ ] **Step 8: Commit and push.**

```bash
git add src/lib/voice-eval/synthetic-input.ts src/lib/voice-adapters/types.ts src/lib/realtime-client.ts src/lib/voice-adapters/elevenlabs-adapter.ts tests/voice-eval-caller-adapter.test.ts
git commit -m "Let voice adapters swap the mic for a synthetic caller track

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 9: `SyntheticCaller` orchestration and the browser caller API

**Files:**
- Create: `src/lib/voice-eval/synthetic-caller/synthetic-caller.ts`
- Create: `src/lib/voice-eval/caller-api.ts`
- Test: `tests/voice-eval-caller-orchestration.test.ts` (create)

**Interfaces:**
- Consumes:
  - `TurnDetector` and `seededRandom` (Task 3);
  - `BeatScheduler` (Task 4);
  - `TranscriptTurn` (Task 5);
  - `MicLike`, `CallerApi`, `CallerRunClosedError`, `CallerSource` and `decodePcm16Base64` (Task 7);
  - the optional adapter methods (Task 8);
  - `VoiceEvalSignal`.
- Produces:
  - `type CallerStatus = 'starting' | 'waiting' | 'thinking' | 'speaking' | 'silent' | 'hanging_up' | 'stopped'`
  - `CALLER_LIMITS`
  - `interface SyntheticCallerDeps`
  - `class SyntheticCaller implements CallerSource`, with `start()`, `stop()`, and `tick()` (public for tests)
  - `callerApi: CallerApi` in `caller-api.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/voice-eval-caller-orchestration.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticCaller, type SyntheticCallerDeps } from '../src/lib/voice-eval/synthetic-caller/synthetic-caller.ts';
import { CallerRunClosedError, type MicLike, type NextTurnResult } from '../src/lib/voice-eval/synthetic-caller/types.ts';
import { getScenario } from '../shared/voice-eval/scenarios/index.ts';
import type { VoiceEvalSignal } from '../shared/voice-eval/evidence.ts';
import type { Scenario } from '../shared/voice-eval/types.ts';

const AUDIO = Buffer.from(new Int16Array(240).buffer).toString('base64');
const say = (text: string): NextTurnResult => ({ action: 'say', text, audioB64: AUDIO });
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };

function harness(scenarioId: string, turns: (NextTurnResult | Error | Promise<NextTurnResult>)[], extra: Partial<SyntheticCallerDeps> = {}) {
  let t = 0;
  let volume = 0;
  const listeners = new Set<(s: VoiceEvalSignal) => void>();
  const published: VoiceEvalSignal[] = [];
  const played: number[] = [];
  const nextTurnInputs: unknown[] = [];
  let hangUps = 0;
  let micClosed = false;
  const adapter = {
    attached: null as unknown,
    attachSyntheticInput: async (track: MediaStreamTrack) => { adapter.attached = track; },
    detachSyntheticInput: async () => { adapter.attached = null; },
    getOutputVolume: () => volume
  };
  const mic: MicLike = {
    track: { id: 'synthetic' } as unknown as MediaStreamTrack,
    play: async () => { const startedAt = t; played.push(startedAt); t += 1000; return { startedAt, endedAt: t }; },
    stopPlayback: () => undefined,
    close: async () => { micClosed = true; }
  };
  const caller = new SyntheticCaller({
    runId: 'run-1',
    scenario: getScenario(scenarioId) as Scenario,
    adapter,
    api: {
      renderBeats: async () => (getScenario(scenarioId) as Scenario).beats.flatMap((b, i) => (b.line ? [{ beatIndex: i, text: b.line, audioB64: AUDIO }] : [])),
      nextTurn: async (input) => {
        nextTurnInputs.push(input);
        const next = turns.shift();
        if (!next) throw new Error('no scripted turn');
        if (next instanceof Error) throw next;
        return next;
      }
    },
    createMic: async () => mic,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    publish: (signal) => published.push(signal),
    hangUp: () => { hangUps += 1; },
    now: () => t,
    sleep: async (ms) => { t += ms; },
    startTicker: () => () => undefined,
    ...extra
  });
  return {
    caller, adapter, published, played, nextTurnInputs,
    emit: (signal: VoiceEvalSignal) => listeners.forEach((l) => l(signal)),
    advance: async (ms: number) => { t += ms; caller.tick(); await settle(); },
    setVolume: (v: number) => { volume = v; },
    now: () => t,
    get hangUps() { return hangUps; },
    get micClosed() { return micClosed; }
  };
}

test('start attaches the mic; the caller opens after 4s of agent silence and publishes its utterance', async () => {
  const h = harness('hc-01', [say('Hi, I need to book a cardiology visit.')]);
  await h.caller.start();
  assert.equal((h.adapter.attached as { id: string }).id, 'synthetic');
  await h.advance(3900);
  assert.equal(h.nextTurnInputs.length, 0);
  await h.advance(100);
  const utterance = h.published.find((s) => s.kind === 'caller_utterance');
  assert.ok(utterance && utterance.kind === 'caller_utterance');
  assert.equal(utterance.text, 'Hi, I need to book a cardiology visit.');
  assert.equal(utterance.source, 'brain');
  assert.equal(utterance.durationMs, 1000);
});

test('waits for the agent turn to end, then sends the transcript including its own lines', async () => {
  const h = harness('hc-01', [say('Hello.'), say('John Hackett.')]);
  await h.caller.start();
  await h.advance(4000);
  h.emit({ kind: 'agent_audio_start', at: h.now() + 100 });
  h.emit({ kind: 'agent_transcript', at: h.now() + 1500, text: 'May I have your name?' });
  h.emit({ kind: 'agent_audio_stop', at: h.now() + 2000 });
  await h.advance(2300);
  assert.equal(h.nextTurnInputs.length, 1, 'still inside the reply gap');
  await h.advance(1000);
  assert.equal(h.nextTurnInputs.length, 2);
  assert.deepEqual((h.nextTurnInputs[1] as { transcript: unknown[] }).transcript, [
    { role: 'caller', text: 'Hello.' },
    { role: 'agent', text: 'May I have your name?' }
  ]);
});

test('hang_up ends the call once, after the delay, and detaches the mic', async () => {
  const h = harness('hc-01', [{ action: 'hang_up', text: '', audioB64: null }]);
  await h.caller.start();
  await h.advance(4000);
  assert.equal(h.hangUps, 1);
  assert.equal(h.adapter.attached, null);
  assert.equal(h.micClosed, true);
  await h.advance(5000);
  assert.equal(h.hangUps, 1);
});

test('one brain failure is retried; two in a row are a harness error and hang up', async () => {
  const retried = harness('hc-01', [new Error('502'), say('Hi.')]);
  await retried.caller.start();
  await retried.advance(4000);
  assert.equal(retried.nextTurnInputs.length, 2);
  assert.equal(retried.published.some((s) => s.kind === 'harness_error'), false);

  const failed = harness('hc-01', [new Error('502'), new Error('502')]);
  await failed.caller.start();
  await failed.advance(4000);
  const harnessError = failed.published.find((s) => s.kind === 'harness_error');
  assert.ok(harnessError && harnessError.kind === 'harness_error' && /502/.test(harnessError.message));
  assert.equal(failed.hangUps, 1);
});

test('a closed run stops the caller quietly', async () => {
  const h = harness('hc-01', [new CallerRunClosedError('Eval run is not running')]);
  await h.caller.start();
  await h.advance(4000);
  assert.equal(h.published.some((s) => s.kind === 'harness_error'), false);
  assert.equal(h.hangUps, 0);
  assert.equal(h.adapter.attached, null);
});

test('hc-06 barges in over the agent without waiting for quiet', async () => {
  const h = harness('hc-06', []);
  await h.caller.start();
  h.setVolume(0.5);
  h.emit({ kind: 'tool_call', at: 10, callId: 'h', name: 'healthcare_patient_access', args: { action: 'hold_slot' } });
  h.emit({ kind: 'tool_result', at: 20, callId: 'h', ok: true, result: { hold: {} } });
  h.emit({ kind: 'agent_audio_start', at: h.now() });
  await h.advance(1199);
  assert.equal(h.played.length, 0);
  await h.advance(1);
  const beat = h.published.find((s) => s.kind === 'beat');
  assert.ok(beat && beat.kind === 'beat' && beat.beatKind === 'barge_in');
  const utterance = h.published.find((s) => s.kind === 'caller_utterance');
  assert.ok(utterance && utterance.kind === 'caller_utterance' && utterance.source === 'beat' && utterance.beatIndex === 0);
});

test('playback guard waits for the agent audio to go quiet before speaking', async () => {
  const h = harness('hc-01', [say('Hi.')]);
  await h.caller.start();
  // Agent audio is still audible until t=6000, 2s after the opening turn fires at t=4000.
  h.adapter.getOutputVolume = () => (h.now() >= 6000 ? 0 : 0.5);
  await h.advance(4000);
  assert.equal(h.played.length, 1);
  assert.ok(h.played[0] >= 6300, `spoke at ${h.played[0]}`);
});

test('stop during an in-flight brain call means no speech and no hang-up', async () => {
  let release: (value: NextTurnResult) => void = () => undefined;
  const pending = new Promise<NextTurnResult>((resolve) => { release = resolve; });
  const h = harness('hc-01', [pending]);
  await h.caller.start();
  await h.advance(4000);
  await h.caller.stop();
  release(say('Too late.'));
  await h.advance(100);
  assert.equal(h.played.length, 0);
  assert.equal(h.hangUps, 0);
  assert.equal(h.adapter.attached, null);
});

test('the turn cap ends the call', async () => {
  const h = harness('hc-01', [say('One.'), say('Two.')], { limits: { maxTurns: 2 } });
  await h.caller.start();
  await h.advance(4000);
  await h.advance(11000);
  assert.equal(h.nextTurnInputs.length, 2);
  await h.advance(11000);
  assert.equal(h.hangUps, 1);
});

test('start failure releases the mic and rejects', async () => {
  const h = harness('hc-01', []);
  h.adapter.attachSyntheticInput = async () => { throw new Error('no sender'); };
  await assert.rejects(h.caller.start(), /no sender/);
  assert.equal(h.micClosed, true);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `node --experimental-strip-types --test tests/voice-eval-caller-orchestration.test.ts`
Expected: FAIL, because the module can't be found.

- [ ] **Step 3: Implement the caller.** Create `src/lib/voice-eval/synthetic-caller/synthetic-caller.ts`:

```ts
import { BeatScheduler } from '../../../../shared/voice-eval/caller/beat-scheduler.ts';
import type { TranscriptTurn } from '../../../../shared/voice-eval/caller/brain-prompt.ts';
import { seededRandom } from '../../../../shared/voice-eval/caller/random.ts';
import { TurnDetector } from '../../../../shared/voice-eval/caller/turn-detector.ts';
import type { VoiceEvalSignal } from '../../../../shared/voice-eval/evidence.ts';
import type { Beat, BeatKind, Scenario } from '../../../../shared/voice-eval/types.ts';
import type { VoiceAdapter } from '../../voice-adapters/types';
import { decodePcm16Base64 } from './pcm.ts';
import { CallerRunClosedError, type CallerApi, type CallerSource, type MicLike, type NextTurnResult } from './types.ts';

export type CallerStatus = 'starting' | 'waiting' | 'thinking' | 'speaking' | 'silent' | 'hanging_up' | 'stopped';

export const CALLER_LIMITS = {
  maxCallMs: 240_000,
  maxTurns: 30,
  hangUpDelayMs: 1500,
  retryDelayMs: 500,
  quietVolume: 0.02,
  quietHoldMs: 300,
  maxGuardMs: 8000,
  guardPollMs: 50,
  tickMs: 50
};

export interface SyntheticCallerDeps {
  runId: string;
  scenario: Scenario;
  adapter: Pick<VoiceAdapter, 'attachSyntheticInput' | 'detachSyntheticInput' | 'getOutputVolume'>;
  api: CallerApi;
  createMic: (noise: Scenario['persona']['noise'], seed: string) => Promise<MicLike>;
  subscribe: (listener: (signal: VoiceEvalSignal) => void) => () => void;
  publish: (signal: VoiceEvalSignal) => void;
  hangUp: () => void;
  onStatus?: (status: CallerStatus) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  startTicker?: (tick: () => void) => () => void;
  limits?: Partial<typeof CALLER_LIMITS>;
}

const defaultTicker = (tick: () => void) => {
  const id = window.setInterval(tick, CALLER_LIMITS.tickMs);
  return () => window.clearInterval(id);
};

export class SyntheticCaller implements CallerSource {
  private readonly limits: typeof CALLER_LIMITS;
  private readonly scheduler: BeatScheduler;
  private readonly beatAudio = new Map<number, Float32Array>();
  private readonly transcript: TranscriptTurn[] = [];
  private detector: TurnDetector | null = null;
  private mic: MicLike | null = null;
  private attached = false;
  private stopped = false;
  private finishing = false;
  private busy = false;
  private turnsTaken = 0;
  private startedAt = 0;
  private silenceUntil: number | null = null;
  private unsubscribe: () => void = () => undefined;
  private stopTicker: () => void = () => undefined;

  constructor(private readonly deps: SyntheticCallerDeps) {
    this.limits = { ...CALLER_LIMITS, ...deps.limits };
    this.scheduler = new BeatScheduler(deps.scenario.beats);
  }

  async start(): Promise<void> {
    this.setStatus('starting');
    try {
      const lines = await this.deps.api.renderBeats(this.deps.runId);
      for (const line of lines) this.beatAudio.set(line.beatIndex, decodePcm16Base64(line.audioB64));
      this.mic = await this.deps.createMic(this.deps.scenario.persona.noise, this.deps.runId);
      if (!this.deps.adapter.attachSyntheticInput) throw new Error('This voice provider does not support the synthetic caller');
      await this.deps.adapter.attachSyntheticInput(this.mic.track);
      this.attached = true;
    } catch (error) {
      this.stopped = true;
      await this.release();
      throw error;
    }
    const random = seededRandom(this.deps.runId);
    this.startedAt = this.now();
    this.detector = new TurnDetector({ startedAt: this.startedAt, gapMs: () => 600 + Math.round(random() * 300) });
    this.unsubscribe = this.deps.subscribe((signal) => this.onSignal(signal));
    this.stopTicker = (this.deps.startTicker ?? defaultTicker)(() => this.tick());
    this.setStatus('waiting');
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.setStatus('stopped');
    await this.release();
  }

  tick(): void {
    if (this.stopped || this.finishing || !this.detector) return;
    const now = this.now();
    if (now - this.startedAt >= this.limits.maxCallMs) {
      void this.finish();
      return;
    }
    if (this.busy) return;
    const barge = this.scheduler.pollBargeIn(now);
    if (barge) {
      void this.runTurn(() => this.speakBeat(barge.beatIndex, barge.beat, false));
      return;
    }
    if (this.silenceUntil !== null) {
      if (now < this.silenceUntil) return;
      this.silenceUntil = null;
    }
    if (!this.detector.poll(now)) return;
    if (this.turnsTaken >= this.limits.maxTurns) {
      void this.finish();
      return;
    }
    void this.runTurn(() => this.takeTurn());
  }

  private onSignal(signal: VoiceEvalSignal): void {
    this.detector?.observe(signal);
    this.scheduler.observe(signal);
    if (signal.kind === 'agent_transcript' && signal.text.trim()) this.transcript.push({ role: 'agent', text: signal.text.trim() });
  }

  private async runTurn(turn: () => Promise<void>): Promise<void> {
    this.busy = true;
    try {
      await turn();
    } catch (error) {
      await this.harnessFailure(error);
    } finally {
      this.busy = false;
    }
  }

  private async takeTurn(): Promise<void> {
    this.turnsTaken += 1;
    const action = this.scheduler.nextTurnAction();
    if (action.kind === 'silence') {
      this.publishBeat(action.beatIndex, 'silence');
      this.silenceUntil = this.now() + action.durationMs;
      this.setStatus('silent');
      return;
    }
    if (action.kind === 'beat') {
      await this.speakBeat(action.beatIndex, action.beat, true);
      return;
    }
    await this.brainTurn();
  }

  private async speakBeat(beatIndex: number, beat: Beat, guard: boolean): Promise<void> {
    const audio = this.beatAudio.get(beatIndex);
    if (!audio || !beat.line) throw new Error(`Beat ${beatIndex} has no pre-rendered audio`);
    this.publishBeat(beatIndex, beat.kind);
    await this.speak(audio, beat.line, 'beat', beatIndex, guard);
  }

  private async brainTurn(): Promise<void> {
    this.setStatus('thinking');
    const result = await this.nextTurnWithRetry();
    if (!result || this.stopped) return;
    if (result.action === 'hang_up') {
      if (result.text && result.audioB64) await this.speak(decodePcm16Base64(result.audioB64), result.text, 'brain', null, true);
      await this.finish();
      return;
    }
    if (!result.audioB64) throw new Error('Caller brain returned a line without audio');
    await this.speak(decodePcm16Base64(result.audioB64), result.text, 'brain', null, true);
  }

  private async nextTurnWithRetry(): Promise<NextTurnResult | null> {
    const input = { runId: this.deps.runId, transcript: [...this.transcript], beatsFired: this.scheduler.firedBeats() };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.deps.api.nextTurn(input);
      } catch (error) {
        if (error instanceof CallerRunClosedError) {
          await this.stop();
          return null;
        }
        if (attempt >= 1) throw error;
        await this.sleep(this.limits.retryDelayMs);
        if (this.stopped) return null;
      }
    }
  }

  private async speak(samples: Float32Array, text: string, source: 'brain' | 'beat', beatIndex: number | null, guard: boolean): Promise<void> {
    if (guard) await this.waitForAgentQuiet();
    const mic = this.mic;
    if (this.stopped || !mic || !this.detector) return;
    this.setStatus('speaking');
    this.detector.callerStarted(this.now());
    const timing = await mic.play(samples);
    this.detector.callerEnded(timing.endedAt);
    if (this.stopped) return;
    this.transcript.push({ role: 'caller', text });
    this.deps.publish({
      kind: 'caller_utterance',
      at: timing.startedAt,
      durationMs: Math.max(0, Math.round(timing.endedAt - timing.startedAt)),
      text,
      source,
      beatIndex
    });
    if (!this.finishing) this.setStatus('waiting');
  }

  // The agent's "not speaking" event can precede the end of its audio; don't clip its last words.
  private async waitForAgentQuiet(): Promise<void> {
    const deadline = this.now() + this.limits.maxGuardMs;
    let quietSince: number | null = null;
    while (!this.stopped && this.now() < deadline) {
      const now = this.now();
      if ((this.deps.adapter.getOutputVolume?.() ?? 0) < this.limits.quietVolume) {
        quietSince ??= now;
        if (now - quietSince >= this.limits.quietHoldMs) return;
      } else {
        quietSince = null;
      }
      await this.sleep(this.limits.guardPollMs);
    }
  }

  private async harnessFailure(error: unknown): Promise<void> {
    if (this.stopped) return;
    const message = error instanceof Error ? error.message : String(error);
    this.deps.publish({ kind: 'harness_error', at: this.now(), message: `synthetic caller: ${message}` });
    await this.finish();
  }

  private async finish(): Promise<void> {
    if (this.finishing || this.stopped) return;
    this.finishing = true;
    this.setStatus('hanging_up');
    await this.sleep(this.limits.hangUpDelayMs);
    if (this.stopped) return;
    await this.stop();
    this.deps.hangUp();
  }

  private publishBeat(beatIndex: number, beatKind: BeatKind): void {
    this.deps.publish({ kind: 'beat', at: this.now(), beatIndex, beatKind });
  }

  private async release(): Promise<void> {
    this.unsubscribe();
    this.unsubscribe = () => undefined;
    this.stopTicker();
    this.stopTicker = () => undefined;
    this.mic?.stopPlayback();
    if (this.attached) {
      this.attached = false;
      try {
        await this.deps.adapter.detachSyntheticInput?.();
      } catch (error) {
        console.warn('[SyntheticCaller] detach failed', error);
      }
    }
    const mic = this.mic;
    this.mic = null;
    await mic?.close().catch(() => undefined);
  }

  private setStatus(status: CallerStatus): void {
    this.deps.onStatus?.(status);
  }

  private now(): number {
    return (this.deps.now ?? (() => performance.now()))();
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? ((delay: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delay))))(ms);
  }
}
```

- [ ] **Step 4: Run the tests.** If any fail, fix the implementation, not the tests.

Run: `node --experimental-strip-types --test tests/voice-eval-caller-orchestration.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Implement the browser caller API.** Create `src/lib/voice-eval/caller-api.ts`:

```ts
import { supabase } from '../supabase';
import { CallerRunClosedError, type CallerApi } from './synthetic-caller/types';

async function invokeCaller<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('voice-eval-caller', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let message = error.message || 'Synthetic caller request failed';
    if (context && typeof context.json === 'function') {
      try {
        const errorBody = (await context.json()) as { error?: unknown } | null;
        if (typeof errorBody?.error === 'string' && errorBody.error) message = errorBody.error;
      } catch {
        // Body was not JSON (or already consumed); keep the generic message.
      }
    }
    if (context?.status === 409) throw new CallerRunClosedError(message);
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const callerApi: CallerApi = {
  async renderBeats(runId) {
    const data = await invokeCaller<{ lines: { beat_index: number; text: string; audio_b64: string }[] }>({ action: 'render', run_id: runId });
    return data.lines.map((line) => ({ beatIndex: line.beat_index, text: line.text, audioB64: line.audio_b64 }));
  },
  async nextTurn({ runId, transcript, beatsFired }) {
    const data = await invokeCaller<{ action: 'say' | 'hang_up'; text: string; audio_b64: string | null }>({
      action: 'next_turn',
      run_id: runId,
      transcript,
      beats_fired: beatsFired
    });
    return { action: data.action, text: data.text, audioB64: data.audio_b64 };
  }
};
```

- [ ] **Step 6: Run the full eval suite and the type check.**

Run: `npm run test:voice-eval && npm run typecheck`
Expected: PASS, with no new type errors.

- [ ] **Step 7: Commit and push.**

```bash
git add src/lib/voice-eval/synthetic-caller/synthetic-caller.ts src/lib/voice-eval/caller-api.ts tests/voice-eval-caller-orchestration.test.ts
git commit -m "Add the synthetic caller that talks to the live agent

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 10: Wire the caller into the voice screen

**Files:**
- Modify: `src/hooks/useVoiceAgent.ts` (the `agent_state` handler at about line 752; the return object at about line 1618)
- Modify: `src/hooks/useVoiceEval.ts`
- Modify: `src/components/voice-eval/EvaluatorPanel.tsx`
- Modify: `src/components/VoiceAgent.tsx` (destructuring at about line 255; `<EvaluatorPanel` at about line 1273)

**Interfaces:**
- Consumes:
  - `SyntheticCaller` and `CallerStatus` (Task 9);
  - `callerApi` (Task 9);
  - `createSyntheticMic` (Task 7);
  - `subscribeVoiceEvalSignals` and `publishVoiceEvalSignal`.
- Produces:
  - `useVoiceAgent()` returns `getAdapter: () => VoiceAdapter | null`.
  - `UseVoiceEvalOptions` gains `getAdapter` and `hangUp: () => void`.
  - `useVoiceEval` returns `callerType`, `setCallerType` and `callerStatus`.
  - `EvaluatorPanel` props gain `getAdapter` and `hangUp`.

- [ ] **Step 1: Publish `agent_audio_stop` and expose the adapter.** In `src/hooks/useVoiceAgent.ts`, inside the `client.on('agent_state', ...)` handler, insert this immediately **before** `lastAgentStateEventRef.current = event.state;`:

```ts
      // Leaving 'speaking' is the agent's audio stop (the synthetic caller's turn detector and barge-in scoring use it).
      if (event.state !== 'speaking' && lastAgentStateEventRef.current === 'speaking') {
        publishVoiceEvalSignal({ kind: 'agent_audio_stop', at: performance.now() });
      }
```

Just above `const cleanup = useCallback(`, add:

```ts
  const getAdapter = useCallback(() => realtimeClientRef.current, []);
```

Add `getAdapter,` to the returned object, directly after `cleanup`.

- [ ] **Step 2: Add the caller lifecycle to `useVoiceEval`.** In `src/hooks/useVoiceEval.ts`:
  1. Add the imports:

```ts
import type { VoiceAdapter } from '../lib/voice-adapters/types';
import { callerApi } from '../lib/voice-eval/caller-api';
import { publishVoiceEvalSignal } from '../lib/voice-eval/signal-bus';
import { createSyntheticMic } from '../lib/voice-eval/synthetic-caller/synthetic-mic';
import { SyntheticCaller, type CallerStatus } from '../lib/voice-eval/synthetic-caller/synthetic-caller';
```

     Change the existing signal-bus import to `import { publishVoiceEvalSignal, subscribeVoiceEvalSignals } from '../lib/voice-eval/signal-bus';`, not a second import line.

  2. Extend the options and the run record:

```ts
export interface UseVoiceEvalOptions {
  sessionId: string | null;
  agentConfigId: string | null;
  fingerprintInput: FingerprintInput;
  getAdapter: () => VoiceAdapter | null;
  hangUp: () => void;
}

interface ActiveRun {
  runId: string;
  scenario: Scenario;
  recorder: EvidenceRecorder;
  unsubscribe: () => void;
  flushTimer: number;
  caller: SyntheticCaller | null;
}
```

  3. Add state next to the existing `useState` calls:

```ts
  const [callerType, setCallerType] = useState<'human' | 'synthetic'>('human');
  const [callerStatus, setCallerStatus] = useState<CallerStatus | null>(null);
```

  4. In `stopRecording`, after `run.unsubscribe();`, add:

```ts
    if (run.caller) void run.caller.stop();
```

  5. In `arm`:
     - Pass `callerType` to `setupEvalRun` in place of the hard-coded `'human'`.
     - Initialize `caller: null` in the `ActiveRun` literal.
     - Add `setCallerStatus(null);` next to `setEvidenceIncomplete(false);`.
     - Insert this block immediately **before** `setLiveScore(scoreRun(scenario, [], { mode: 'live', snapshot: null }));`:

```ts
      if (callerType === 'synthetic') {
        const adapter = optionsRef.current.getAdapter();
        if (!adapter?.attachSyntheticInput) throw new Error('This voice provider does not support the synthetic caller');
        const caller = new SyntheticCaller({
          runId: setup.run_id,
          scenario,
          adapter,
          api: callerApi,
          createMic: createSyntheticMic,
          subscribe: subscribeVoiceEvalSignals,
          publish: publishVoiceEvalSignal,
          hangUp: () => optionsRef.current.hangUp(),
          onStatus: setCallerStatus
        });
        run.caller = caller;
        await caller.start();
        if (token.cancelled) {
          stopRecording();
          if (runRef.current === run) runRef.current = null;
          discardServerRun(setup.run_id);
          return;
        }
      }
```

     - Add `callerType` to `arm`'s `useCallback` dependency list.

  6. Return `callerType`, `setCallerType` and `callerStatus` from the hook.

- [ ] **Step 3: Update the panel.** In `src/components/voice-eval/EvaluatorPanel.tsx`:
  1. Extend the props and pass them through:

```ts
import { useEffect } from 'react';
import type { VoiceAdapter } from '../../lib/voice-adapters/types';

interface EvaluatorPanelProps {
  isConnected: boolean;
  sessionId: string | null;
  agentConfigId: string | null;
  fingerprintInput: FingerprintInput;
  getAdapter: () => VoiceAdapter | null;
  hangUp: () => void;
}
```

     In the function signature, destructure `getAdapter` and `hangUp` as well. Call `useVoiceEval({ sessionId, agentConfigId, fingerprintInput, getAdapter, hangUp })`.

  2. After `const running = ...`, add:

```ts
  const syntheticSupported = isConnected && typeof getAdapter()?.attachSyntheticInput === 'function';
  const synthetic = evalRun.callerType === 'synthetic';
  useEffect(() => {
    if (isConnected && !syntheticSupported && evalRun.callerType === 'synthetic' && !running) evalRun.setCallerType('human');
  }, [isConnected, syntheticSupported, evalRun, running]);
```

  3. Replace the static You/Synthetic `<div className="grid grid-cols-2 ...">…</div>` with:

```tsx
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-slate-950/60 p-1 text-xs">
          <button
            type="button"
            disabled={running}
            onClick={() => evalRun.setCallerType('human')}
            className={cn('rounded-md px-3 py-1 text-center', !synthetic ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/50')}
          >
            You
          </button>
          <button
            type="button"
            disabled={running || !syntheticSupported}
            title={syntheticSupported ? 'A scripted caller runs the scenario hands-free' : 'Connect a supported voice provider (OpenAI Realtime, xAI or ElevenLabs TTS) to use the synthetic caller'}
            onClick={() => evalRun.setCallerType('synthetic')}
            className={cn('rounded-md px-3 py-1 text-center disabled:opacity-40', synthetic ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/50')}
          >
            Synthetic
          </button>
        </div>
```

  4. In the scenario card, wrap the `Your details` heading, the facts list and the beats list in `{!synthetic && (<>…</>)}`. Then add this after them, still inside the card:

```tsx
          {synthetic && (
            <p className="mt-2 text-white/60">
              {phase === 'live' && evalRun.callerStatus
                ? `Caller: ${evalRun.callerStatus.replace('_', ' ')}`
                : 'The synthetic caller plays this scenario hands-free. Your microphone is off during the run.'}
            </p>
          )}
```

  5. Change the arming hint so it only shows for the human caller:

```tsx
      {phase === 'arming' && <p className="text-xs text-white/50">{synthetic ? 'Preparing the synthetic caller…' : 'Wait until the panel shows LIVE before speaking.'}</p>}
```

- [ ] **Step 4: Pass the adapter and hang-up from `VoiceAgent`.** In `src/components/VoiceAgent.tsx`:
  - add `getAdapter,` to the `useVoiceAgent` destructuring, directly after `cleanup`;
  - add these props to `<EvaluatorPanel`:

```tsx
                                getAdapter={getAdapter}
                                hangUp={() => { void handleEnd(); }}
```

- [ ] **Step 5: Type-check, lint, test and build.**

Run: `npm run typecheck && npx eslint src/hooks/useVoiceEval.ts src/hooks/useVoiceAgent.ts src/components/voice-eval/EvaluatorPanel.tsx src/components/VoiceAgent.tsx src/lib/voice-eval && npm run test:voice-eval && npm run test:voice && npm run build`
Expected: all pass. The build succeeds with no new warnings about these files.

- [ ] **Step 6: Commit and push.**

```bash
git add src/hooks/useVoiceAgent.ts src/hooks/useVoiceEval.ts src/components/voice-eval/EvaluatorPanel.tsx src/components/VoiceAgent.tsx
git commit -m "Run evals with the synthetic caller from the Evaluator panel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push origin main
```

---

### Task 11: Deploy and manual acceptance

**Files:** none new. This task deploys and verifies.

- [ ] **Step 1: Deploy both functions.** The `voice-eval` function bundles the shared scorer that Task 2 changed. Retry a deploy once on a transient 500.

```bash
supabase functions deploy voice-eval-caller --project-ref mnrseaapxpofdznnqrsv
supabase functions deploy voice-eval --project-ref mnrseaapxpofdznnqrsv
```

Expected: both report `Deployed Function`.

- [ ] **Step 2: Smoke-test `voice-eval-caller` auth.**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mnrseaapxpofdznnqrsv.supabase.co/functions/v1/voice-eval-caller -H 'Content-Type: application/json' -d '{}'
```

Expected: `401`.

- [ ] **Step 3: Hand off to the owner for manual acceptance.** Ask them to:
  1. run `npm run dev`;
  2. open the voice screen with "HLS Patient Access · Jev + GPT-Live" and connect;
  3. open the Evaluator and choose **Synthetic**;
  4. run hc-01 through hc-10 one at a time.

  For each scenario, record the verdict and anything odd. The acceptance bar:
  - every run ends in `pass`/`fail`, or in `invalid_harness` with a readable reason, and none hangs;
  - the caller never talks over the agent except at hc-06's beat;
  - hc-06's turn-taking row shows a measured barge-in cutoff;
  - hc-08 is audibly noisy and its entity report is filled in;
  - hc-09's silence produces an agent re-prompt, or a silence violation.

- [ ] **Step 4: Record the outcome in memory.** Update `voice-evaluator-status.md` in the memory dir to record: phase 2 shipped, the acceptance results, and any follow-ups the owner deferred.

---

## Self-Review Notes

- **Spec coverage:**
  - §2.1 units map to Tasks 3–9;
  - the scenario schema changes are in Task 1;
  - the §2.1 hook and panel changes are in Task 10;
  - §3.1–3.4 behaviour is in Tasks 3, 4 and 9;
  - §4 scoring is in Task 2;
  - the §5 errors are covered by Task 6 (404/409/400/502) and Task 9 (retry, harness error, closed run, start failure, abort). The `AudioContext` suspended case is handled in `createSyntheticMic` (Task 7);
  - §6 tests are in each task;
  - §7 deploy is in Task 11.
- The spec's "100 ms frames" for the WebSocket pump is implemented with the existing `pcm-downsampler` worklet's framing. The frame size isn't load-bearing.
- The spec's `caller-source.ts` file is folded into `synthetic-caller/types.ts` to keep all the caller contracts in one place.
