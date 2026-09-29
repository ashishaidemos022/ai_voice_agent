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
  let subscribes = 0;
  let tickers = 0;
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
    subscribe: (listener) => { subscribes += 1; listeners.add(listener); return () => listeners.delete(listener); },
    publish: (signal) => published.push(signal),
    hangUp: () => { hangUps += 1; },
    now: () => t,
    sleep: async (ms) => { t += ms; },
    startTicker: () => { tickers += 1; return () => undefined; },
    ...extra
  });
  return {
    caller, adapter, published, played, nextTurnInputs,
    emit: (signal: VoiceEvalSignal) => listeners.forEach((l) => l(signal)),
    advance: async (ms: number) => { t += ms; caller.tick(); await settle(); },
    setVolume: (v: number) => { volume = v; },
    now: () => t,
    passTime: (ms: number) => { t += ms; },
    get hangUps() { return hangUps; },
    get micClosed() { return micClosed; },
    get subscribes() { return subscribes; },
    get tickers() { return tickers; }
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

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

for (const stage of ['renderBeats', 'createMic', 'attachSyntheticInput'] as const) {
  test(`stop during start (${stage}) releases everything once start settles`, async () => {
    const gate = deferred();
    let ownMicClosed = false;
    const ownMic: MicLike = {
      track: { id: 'own' } as unknown as MediaStreamTrack,
      play: async () => ({ startedAt: 0, endedAt: 0 }),
      stopPlayback: () => undefined,
      close: async () => { ownMicClosed = true; }
    };
    let micsCreated = 0;
    const extra: Partial<SyntheticCallerDeps> = {
      createMic: async () => { micsCreated += 1; if (stage === 'createMic') await gate.promise; return ownMic; }
    };
    if (stage === 'renderBeats') {
      extra.api = { renderBeats: async () => { await gate.promise; return []; }, nextTurn: async () => { throw new Error('unused'); } };
    }
    const h = harness('hc-01', [], extra);
    if (stage === 'attachSyntheticInput') {
      h.adapter.attachSyntheticInput = async (track: MediaStreamTrack) => { await gate.promise; h.adapter.attached = track; };
    }
    const starting = h.caller.start();
    await settle();
    await h.caller.stop();
    gate.resolve();
    await starting;
    await settle();
    assert.equal(h.adapter.attached, null, 'adapter detached');
    assert.equal(micsCreated === 0 || ownMicClosed, true, 'any created mic is closed');
    if (stage !== 'renderBeats') assert.equal(ownMicClosed, true);
    assert.equal(h.subscribes, 0, 'no subscription');
    assert.equal(h.tickers, 0, 'no ticker');
  });
}

test('a brain failure after the call cap fired publishes no harness_error and hangs up once', async () => {
  const hangUpGate = deferred();
  const firstAttempt = deferred<NextTurnResult>();
  const h = harness('hc-01', [firstAttempt.promise, new Error('502')], {
    limits: { maxCallMs: 5000 },
    sleep: async (ms) => { if (ms === 1500) await hangUpGate.promise; else h.passTime(ms); }
  });
  await h.caller.start();
  await h.advance(4000);
  assert.equal(h.nextTurnInputs.length, 1, 'brain call in flight');
  await h.advance(1000);
  firstAttempt.reject(new Error('502'));
  await settle();
  assert.equal(h.nextTurnInputs.length, 2, 'retried during the hang-up delay');
  assert.equal(h.published.some((s) => s.kind === 'harness_error'), false);
  assert.equal(h.hangUps, 0);
  hangUpGate.resolve();
  await settle();
  assert.equal(h.hangUps, 1);
  assert.equal(h.published.some((s) => s.kind === 'harness_error'), false);
});

test('a brain line that arrives after the call cap fired is not spoken', async () => {
  const hangUpGate = deferred();
  const firstAttempt = deferred<NextTurnResult>();
  const h = harness('hc-01', [firstAttempt.promise], {
    limits: { maxCallMs: 5000 },
    sleep: async (ms) => { if (ms === 1500) await hangUpGate.promise; else h.passTime(ms); }
  });
  await h.caller.start();
  await h.advance(4000);
  await h.advance(1000);
  firstAttempt.resolve(say('Late line.'));
  await settle();
  assert.equal(h.played.length, 0);
  hangUpGate.resolve();
  await settle();
  assert.equal(h.hangUps, 1);
});
