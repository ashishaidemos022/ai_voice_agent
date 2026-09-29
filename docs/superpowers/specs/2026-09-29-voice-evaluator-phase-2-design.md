# Voice Agent Evaluator — Phase 2: Synthetic Caller — Design

Date: 2026-09-29
Status: Draft for review
Parent spec: `docs/superpowers/specs/2026-09-29-voice-agent-evaluator-design.md` (§2.1 SyntheticCaller, §10 phase 2)
Builds on: phase 1 (shipped at `264eeab`)

## 1. Intent

**Goal:** the owner picks a healthcare scenario, switches the Evaluator to **Synthetic**, clicks Start, and the call runs hands-free to a verdict. A scripted synthetic caller talks to the live agent over the real audio path.

**Done means:** all 10 scenarios (hc-01…hc-10) run hands-free against "HLS Patient Access · Jev + GPT-Live" (config `cb0d2bb7-4c0f-4975-a232-cd6b33c32222`). That includes the timed barge-in (hc-06), café noise (hc-08), the correction (hc-05) and the 12 s silence (hc-09). Each run ends in `pass`/`fail`, or in `invalid_harness` with a clear reason.

**Decisions**

| Decision | Choice |
|---|---|
| Caller approach | In-browser scripted caller (parent spec approach A) |
| Turn detection | Event-driven, from the eval signal bus (§3.1); no output-audio VAD |
| Caller brain | `gpt-5.4-mini` (`OPENAI_MODELS.chat.mini`), structured output, server-side |
| Caller TTS | ElevenLabs, per-persona `voiceId`, server-side, using the owner's stored key in `va_provider_keys` |
| Noise | Procedurally generated in WebAudio; no asset files |
| Barge-in and correction timing | Beats gain an optional tool **anchor** |
| Transports | WebRTC (OpenAI path) and WebSocket (xAI, ElevenLabs-TTS) |
| Run model | Manual, one scenario at a time from the Evaluator panel; suites stay in phase 3 |

**Non-goals:** suites, serial runners and regressions (phase 3); synthetic support for `elevenlabs_agent`, `personaplex` and routed voice; output-audio energy VAD; recorded noise assets.

## 2. Architecture

```
EvaluatorPanel (You | Synthetic)
  └─ useVoiceEval ── arm(callerType) ──▶ voice-eval: setup
        │                               voice-eval-caller: render (beat lines, pre-rendered)
        └─ SyntheticCaller (CallerSource)
              ├─ TurnDetector   ◀── signal bus (agent_audio_start/stop, tool_call/result, agent_transcript)
              ├─ BeatScheduler  ── decides: beat line | silence | brain turn | hang up
              ├─ voice-eval-caller: next_turn (brain → TTS → PCM)
              └─ SyntheticMicSource (AudioContext → MediaStreamDestination: silence + utterances + noise)
                     └─▶ adapter.attachSyntheticInput(track)  (replaces the mic for the whole call)
```

### 2.1 Units

**Pure logic — `shared/voice-eval/caller/`** (no DOM, unit-tested, reusable server-side)

- `turn-detector.ts`: a state machine fed evidence events and a clock. It emits `agent_turn_ended` and `agent_quiet` (§3.1).
- `beat-scheduler.ts`: given the scenario beats, the caller-turn index, the anchors met so far and the fired beats, it returns the next action: `{ kind: 'beat', beat } | { kind: 'silence', ms } | { kind: 'brain' }`. It also owns barge-in arming (§3.3).
- `brain-prompt.ts`: builds the brain request from the persona, goal, visible facts and transcript; parses and validates the response (`{ action: 'say', text } | { action: 'hang_up', text? }`).

**Edge Function — `supabase/functions/voice-eval-caller/index.ts`**

The logic lives in `shared/voice-eval/caller/server.ts`, with OpenAI, ElevenLabs and the DB injected, so it can be unit-tested. The function has two actions:

| Action | Input | Output |
|---|---|---|
| `render` | `run_id`, `lines[]`, `voice_id` | `[{ text, audio_b64 }]`: PCM 24 kHz mono, used to pre-render beat lines at arming |
| `next_turn` | `run_id`, `scenario_id`, `transcript[]`, `beats_fired[]` | `{ action, text, audio_b64? }`: brain line plus its TTS |

- **Auth:** the caller's JWT is required. `run_id` must belong to the caller and have status `running`.
- **TTS:** ElevenLabs `POST /v1/text-to-speech/{voice_id}` with `output_format=pcm_24000` and model `eleven_flash_v2_5`. The key is resolved in two steps. First, the run's agent config `voice_provider_key_id`, if that row's provider is `elevenlabs`. Otherwise, the owner's most recent `elevenlabs` row in `va_provider_keys`, found via `va_users` from the run's `owner_id`. If neither exists, `render` fails, so arming fails with "No ElevenLabs key for the synthetic caller."
- **Brain:** OpenAI Responses API, model `OPENAI_MODELS.chat.mini`, JSON-schema structured output, using `OPENAI_API_KEY`. The scenario is loaded server-side from the shared scenario pack by id, so the browser can't alter the persona or goal.

**Browser — `src/lib/voice-eval/synthetic-caller/`**

- `caller-source.ts`: the `CallerSource` interface: `start(ctx)`, `stop()`. (`onAgentTurn` from the parent spec is subsumed by the signal-bus subscription.)
- `synthetic-mic.ts`: `SyntheticMicSource`. One `AudioContext` at 24 kHz and a `MediaStreamDestination`. The track carries silence by default, and `play(pcm): Promise<{ startedAt, endedAt }>` schedules an utterance. The noise bed is mixed in continuously. Timestamps are `performance.now()`, taken at actual playback start and end.
- `noise.ts`: procedural noise beds, each deterministic via a seed:
  - `car`: low-passed brown noise.
  - `cafe`: pink noise, plus random clatter transients, plus a band-limited murmur.
  - `speakerphone`: a 300–3400 Hz band-pass with mild waveshaper distortion applied to the caller voice, not a bed.
  - `none`: silence.

  The level is set so the SNR is about 10 dB (café, car) against speech RMS.
- `synthetic-caller.ts`: `SyntheticCaller implements CallerSource`. It wires the detector, scheduler, `voice-eval-caller` calls and the mic together, and publishes caller evidence.

**Adapter changes**

- `VoiceAdapter` (`src/lib/voice-adapters/types.ts`) gains optional `attachSyntheticInput(track: MediaStreamTrack): Promise<void>` and `detachSyntheticInput(): Promise<void>`.
- `RealtimeAPIClient`:
  - **WebRTC:** `replaceTrack(synthetic)` on the audio sender, held until detach, which restores the original mic track. The synthetic track is `enabled`; the real mic stays disabled.
  - **WebSocket:** an AudioWorklet reads the synthetic track and pumps 100 ms Int16 frames into `sendAudio` until detach.
  - The one-shot `injectAudio` is left as-is; it serves benchmarks.
- `ElevenLabsAdapter` delegates both methods to its inner `RealtimeAPIClient`.
- Other adapters don't implement them. The panel treats a missing method as "Synthetic unsupported."

**Signals and evidence**

- `useVoiceAgent` publishes a new `agent_audio_stop` signal on the transition out of `speaking`.
- The caller publishes:
  - `caller_utterance { text, startMs, endMs, source: 'brain' | 'beat', beatIndex? }`
  - `beat { beatIndex, kind, firedAtMs }`
  - `harness_error { message }` (this kind already exists)
- `EvidenceEvent` and the evidence row mapping gain these kinds. The scorer changes are in §4.

**Scenario schema changes**

- `Beat` gains an optional `anchor?: { afterTool: HealthcareAction }`. The beat becomes eligible only after a successful `tool_result` for that action.
- hc-06 (barge-in) gets `anchor: { afterTool: 'hold_slot' }` and moves to v4.
- hc-05 (correction) gets `anchor: { afterTool: 'search_availability' }` and moves to v3. Its `afterTurn` becomes a minimum: it fires at the first caller turn that is at or after `afterTurn` **and** after the anchor.
- The scenario validator accepts `anchor.afterTool` only if it's a known action.

**Hook and panel**

- `useVoiceEval.arm()` takes `callerType: 'human' | 'synthetic'` (currently hard-coded `'human'`). In synthetic mode, arming also:
  1. pre-renders the beat lines;
  2. builds the `SyntheticMicSource`;
  3. calls `adapter.attachSyntheticInput`;
  4. starts the `SyntheticCaller`.

  If any of these fail, arming fails as it does today (run discarded, error shown).
- `useVoiceEval` needs the active adapter. `VoiceAgent.tsx` passes a getter (`getVoiceAdapter()`) exposed by `useVoiceAgent`, and a `hangUp()` callback for the caller.
- `EvaluatorPanel`: the You/Synthetic switch becomes interactive, and Synthetic is disabled with a note when the adapter lacks `attachSyntheticInput`. The scenario card hides "Your details" in synthetic mode and shows a live caller line instead ("Caller: speaking… / thinking… / waiting").

## 3. Behaviour

### 3.1 Turn detection (event-driven)

The detector sees `agent_audio_start`, `agent_audio_stop`, `tool_call`, `tool_result` and `agent_transcript`. It fires `agent_turn_ended` when all of these hold:

1. the agent has gone from speaking to not speaking (`agent_audio_stop`);
2. no tool call is in flight (every `tool_call` has its `tool_result`);
3. a human gap has elapsed: 600 ms, plus uniform jitter of 0–300 ms from the run seed, with no new `agent_audio_start`. A new start cancels the pending end.

`agent_quiet` fires when the agent hasn't spoken for 10 s, no tool call is in flight, and the caller isn't speaking. The caller then takes a brain turn, which will usually produce "Hello? Are you still there?"

While the caller's own utterance is playing, the detector ignores agent-stop events that come from the agent reacting to the caller. It re-arms once the caller utterance ends.

### 3.2 The call

1. **Precondition:** the voice session is connected, as in human mode.
2. **Arming:** as in §2.1 Hook and panel. The panel shows LIVE when the caller has started.
3. **Opening:** if `agent_audio_start` arrives within 4 s, wait for `agent_turn_ended`. Otherwise take a brain turn.
4. **Each caller turn** (on `agent_turn_ended` or `agent_quiet`): ask the scheduler.
   - `beat` (a `say` or `correction` that is due): play the pre-rendered line verbatim.
   - `silence`: speak nothing for `durationMs`, then wait for the next `agent_turn_ended` or `agent_quiet`. The agent's re-prompt is the behaviour hc-09 measures.
   - `brain`: call `next_turn`, then play the returned audio, or hang up.
5. **Brain context:**
   - persona and temperament, goal, and the visible facts;
   - the transcript: agent turns plus caller utterances, beat lines included;
   - an instruction to speak like a phone caller, in one or two short sentences, giving facts only when asked.
   - A fact that is the `correctedFact` of a not-yet-fired correction beat is hidden until that beat fires. The goal text drives the pre-correction behaviour (for example, "first ask for Tuesday").
6. **Ending:**
   - The brain returns `hang_up` (goal done, or the agent said goodbye); play its optional closing line.
   - Or a cap is hit: 4 minutes wall clock, or 30 caller turns.
   - Either way: wait 1.5 s, stop the caller, detach, and call `hangUp()`. Phase 1's auto-score-on-hang-up then scores the run. Hitting a cap isn't a harness error.

Caller think time (brain plus TTS, about 1–2 s) isn't agent latency. Latency is measured from the caller utterance **end**.

### 3.3 Barge-in

- A `barge_in` beat is armed once its anchor is met.
- On the next `agent_audio_start`, the scheduler starts a timer for `afterAgentSpeechMs` and then plays the pre-rendered line over the agent. This is the only case where the caller deliberately talks over the agent.
- If the agent stops before the timer fires, the beat stays armed for the next agent turn.
- A barge-in beat fires at most once.

### 3.4 Correction, say and silence

- `say` / `correction`: fire at the first caller turn whose index is at least `afterTurn` and whose anchor (if any) is met. Played verbatim instead of a brain line.
- `silence`: at the caller turn at or after `afterTurn`, the caller stays silent for `durationMs`, then resumes the normal loop.

## 4. Scoring changes

Only phase-1 scorer modules change, and only where synthetic evidence gives better ground truth:

- **Latency** (`scoring/latency.ts`): when `caller_utterance` events exist, a turn's start is the utterance `endMs`. Otherwise it falls back to `caller_speech_stop`, as today.
- **Barge-in** (`scoring/turn-taking.ts`): cutoff = the first `agent_audio_stop` after a beat-sourced `caller_utterance.startMs`, minus that start. Gate ≤ 500 ms. No stop within 5 s counts as a failed cutoff.
- **Silence** (`scoring/turn-taking.ts`): when `caller_utterance` events exist, use their exact times instead of the `CALLER_MS_PER_WORD` back-dating.
- **Talk-over**: agent audio starts while a caller utterance is playing (excluding the barge-in beat itself) are counted from the exact utterance windows.
- **Human mode is unchanged.** The server re-scores with the same shared code, so no Edge Function logic changes beyond the new evidence kinds.

## 5. Error handling

| Failure | Behaviour |
|---|---|
| Beat pre-render (`render`) fails | Arming fails; the run is discarded (teardown); the panel shows the error |
| `next_turn` fails (brain or TTS) | Retry once after 500 ms. A second failure publishes `harness_error`, hangs up, and the run scores `invalid_harness` |
| Brain output fails validation | Treated as a `next_turn` failure |
| `attachSyntheticInput` fails (no audio sender, closed context) | Arming fails before LIVE; nothing is spoken |
| `AudioContext` suspended (tab backgrounded) | Resume on start; if it's still suspended, `harness_error` and end the run |
| Unsupported provider | Synthetic is disabled in the panel with a note; human mode works |
| Abort, unmount or manual hang-up mid-call | Caller stops, the original mic track is restored, and phase 1's abort or auto-score path runs |
| Run no longer `running` when `voice-eval-caller` is called | 409; the caller stops without publishing `harness_error` (the run is already being scored or aborted) |

## 6. Testing

Test-first, `node --test`, in the phase-1 style. The new files are `tests/voice-eval-caller-*.test.ts` and are included in `test:voice-eval`.

- **Turn detector:**
  - no turn end while a tool call is in flight;
  - the gap plus seeded jitter;
  - an `agent_audio_start` during the gap cancels the turn end;
  - the 10 s quiet fallback;
  - agent stops during caller playback are ignored.
- **Beat scheduler:**
  - `say`/`correction` at `afterTurn` with and without an anchor;
  - `silence` duration;
  - barge-in waits for its anchor, re-arms if the agent stops early, and fires once;
  - every hc-01…hc-10 scenario yields a valid beat plan.
- **Brain prompt:** the correction fact is hidden until its beat fires; `say`/`hang_up` parsing; malformed output is rejected.
- **`voice-eval-caller` server module**, with fake OpenAI, ElevenLabs and DB:
  - run ownership and the `running` check (including the 409);
  - `render` batches lines;
  - `next_turn` returns text plus audio;
  - TTS failure is surfaced as an error.
- **Adapter**, with a mocked `RTCPeerConnection`:
  - attach replaces the sender track and detach restores the original;
  - the WebSocket pump sends frames at 24 kHz pacing.
- **Scorer:** synthetic-evidence fixtures covering latency from the utterance end, barge-in cutoff pass and fail, and silence using exact times.
- **Scenario validator:** anchors on hc-05 and hc-06; an unknown anchor action is rejected.
- **Manual acceptance:** the owner runs hc-01…hc-10 hands-free against the Jev + GPT-Live config. Each ends in a verdict or a clearly explained `invalid_harness`; no scenario hangs; the caller never talks over the agent except at hc-06's beat; hc-06 reports a measured cutoff.

## 7. Configuration

| Item | Where | Notes |
|---|---|---|
| `OPENAI_API_KEY` | Existing Edge Function secret | Brain |
| ElevenLabs key | Existing `va_provider_keys` row (provider `elevenlabs`) | Caller TTS; no new secret |
| Deploy | `supabase functions deploy voice-eval-caller --project-ref mnrseaapxpofdznnqrsv` | Also redeploy `voice-eval` because the shared scorer changes |

No database migration: the evidence `kind` column is free text, and `caller_type = 'synthetic'` is already allowed.
