import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  Clipboard,
  Clock3,
  Download,
  FlaskConical,
  Play,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles
} from 'lucide-react';
import { getAllConfigPresets, type AgentConfigPreset } from '../../lib/config-service';
import { useAgentState } from '../../state/agentState';
import { useAuth } from '../../context/AuthContext';
import { MainLayout } from '../layout/MainLayout';
import { Sidebar } from '../layout/Sidebar';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';

type VoiceLabProps = {
  onNavigateVoice: () => void;
  onNavigateChat?: () => void;
  onOpenCreateAgent?: () => void;
  onOpenSkills?: () => void;
  onOpenKnowledgeBase?: () => void;
  onOpenUsage?: () => void;
  onOpenEmbedUsage?: () => void;
};

type CandidateKey = 'a' | 'b';
type ScoreKey = 'naturalness' | 'expressiveness' | 'latency' | 'turnTaking' | 'instruction';
type Scores = Record<CandidateKey, Record<ScoreKey, number>>;

type SavedRun = {
  id: string;
  createdAt: string;
  scenario: string;
  candidateA: string;
  candidateB: string;
  providerA: string;
  providerB: string;
  scores: Scores;
  latencyMs: Record<CandidateKey, string>;
  notes: string;
};

type VoiceLabDraft = {
  candidateAId?: string;
  candidateBId?: string;
  scenarioId?: (typeof scenarios)[number]['id'];
  scores?: Scores;
  latencyMs?: Record<CandidateKey, string>;
  notes?: string;
};

const scoreLabels: Array<{ key: ScoreKey; label: string; hint: string }> = [
  { key: 'naturalness', label: 'Naturalness', hint: 'Human cadence, pronunciation, lack of artifacts' },
  { key: 'expressiveness', label: 'Expression', hint: 'Emotion, emphasis, pacing, personality' },
  { key: 'latency', label: 'Speed', hint: 'How quickly the first audible response begins' },
  { key: 'turnTaking', label: 'Turn-taking', hint: 'Interruptions, pauses, and conversational timing' },
  { key: 'instruction', label: 'Prompt fit', hint: 'Follows the requested tone and constraints' }
];

const scenarios = [
  {
    id: 'natural',
    name: 'Natural conversation',
    duration: '45 sec',
    prompt: 'You are in a voice benchmark. Greet me warmly, ask what brought me here today, then respond conversationally to my answer. Keep every turn under two sentences.',
    watch: 'Cadence, pronunciation, filler words, and whether it feels like a real conversation.'
  },
  {
    id: 'emotion',
    name: 'Emotional range',
    duration: '35 sec',
    prompt: 'You are in a voice benchmark. Deliver this update with concern at first, then clear relief and warm enthusiasm: “I was worried we might miss the deadline. But the final test just passed—and that means we can launch today.” Do not add any other words.',
    watch: 'Emotional transition, emphasis, breath, pacing, and whether the delivery feels acted or authentic.'
  },
  {
    id: 'numbers',
    name: 'Clarity & precision',
    duration: '30 sec',
    prompt: 'You are in a voice benchmark. Say exactly: “Your appointment is Thursday, August 21st at 2:45 PM. The total is $1,247.38, and your confirmation code is A7B-904.”',
    watch: 'Dates, currency, letters, digits, pronunciation, and consistent volume.'
  },
  {
    id: 'turns',
    name: 'Latency & interruption',
    duration: '60 sec',
    prompt: 'You are in a voice benchmark. Explain in three short points why voice agents are useful. I may interrupt you; stop promptly, acknowledge what I said, and continue only if I ask.',
    watch: 'Time to first audio, barge-in behavior, recovery, and awkward silence between turns.'
  }
] as const;

const emptyScores = (): Scores => ({
  a: { naturalness: 3, expressiveness: 3, latency: 3, turnTaking: 3, instruction: 3 },
  b: { naturalness: 3, expressiveness: 3, latency: 3, turnTaking: 3, instruction: 3 }
});

const loadDraft = (): VoiceLabDraft => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem('voice-lab-draft') || '{}');
  } catch {
    return {};
  }
};

const providerLabel = (preset?: AgentConfigPreset) => {
  if (!preset) return 'Not selected';
  if (preset.voice_provider === 'elevenlabs_agent') return 'ElevenLabs Agent';
  if (preset.voice_provider === 'elevenlabs_tts') return 'ElevenLabs Expressive';
  if (preset.voice_provider === 'personaplex') return 'PersonaPlex';
  return 'OpenAI Realtime';
};

const voiceLabel = (preset?: AgentConfigPreset) => preset?.voice_id || preset?.voice || 'Default voice';

const average = (scores: Record<ScoreKey, number>) => {
  const values = Object.values(scores);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export function VoiceLab({
  onNavigateVoice,
  onNavigateChat,
  onOpenCreateAgent,
  onOpenSkills,
  onOpenKnowledgeBase,
  onOpenUsage,
  onOpenEmbedUsage
}: VoiceLabProps) {
  const { vaUser, signOut } = useAuth();
  const setActiveConfigId = useAgentState((state) => state.setActiveConfigId);
  const [initialDraft] = useState<VoiceLabDraft>(loadDraft);
  const [presets, setPresets] = useState<AgentConfigPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidateAId, setCandidateAId] = useState(initialDraft.candidateAId || '');
  const [candidateBId, setCandidateBId] = useState(initialDraft.candidateBId || '');
  const [scenarioId, setScenarioId] = useState<(typeof scenarios)[number]['id']>(initialDraft.scenarioId || 'natural');
  const [scores, setScores] = useState<Scores>(initialDraft.scores || emptyScores());
  const [latencyMs, setLatencyMs] = useState<Record<CandidateKey, string>>(initialDraft.latencyMs || { a: '', b: '' });
  const [notes, setNotes] = useState(initialDraft.notes || '');
  const [copied, setCopied] = useState<CandidateKey | null>(null);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(window.localStorage.getItem('voice-lab-runs') || '[]');
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let mounted = true;
    getAllConfigPresets()
      .then((data) => {
        if (!mounted) return;
        setPresets(data);
        const openAI = data.find((item) => !item.voice_provider || item.voice_provider === 'openai_realtime');
        const eleven = data.find((item) => item.voice_provider === 'elevenlabs_tts' || item.voice_provider === 'elevenlabs_agent');
        setCandidateAId((current) => data.some((item) => item.id === current) ? current : openAI?.id || data[0]?.id || '');
        setCandidateBId((current) => data.some((item) => item.id === current) ? current : eleven?.id || data.find((item) => item.id !== openAI?.id)?.id || data[0]?.id || '');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load voice agents'))
      .finally(() => mounted && setIsLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem('voice-lab-draft', JSON.stringify({
      candidateAId,
      candidateBId,
      scenarioId,
      scores,
      latencyMs,
      notes
    }));
  }, [candidateAId, candidateBId, scenarioId, scores, latencyMs, notes]);

  const candidateA = useMemo(() => presets.find((item) => item.id === candidateAId), [presets, candidateAId]);
  const candidateB = useMemo(() => presets.find((item) => item.id === candidateBId), [presets, candidateBId]);
  const scenario = scenarios.find((item) => item.id === scenarioId) || scenarios[0];

  const copyPrompt = async (candidate: CandidateKey) => {
    try {
      await navigator.clipboard.writeText(scenario.prompt);
      setCopied(candidate);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  };

  const launchCandidate = async (candidate: CandidateKey) => {
    const id = candidate === 'a' ? candidateAId : candidateBId;
    if (!id) return;
    await copyPrompt(candidate);
    setActiveConfigId(id);
    onNavigateVoice();
  };

  const updateScore = (candidate: CandidateKey, key: ScoreKey, value: number) => {
    setScores((current) => ({
      ...current,
      [candidate]: { ...current[candidate], [key]: value }
    }));
  };

  const saveRun = () => {
    if (!candidateA || !candidateB) return;
    const next: SavedRun = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      scenario: scenario.name,
      candidateA: candidateA.name,
      candidateB: candidateB.name,
      providerA: providerLabel(candidateA),
      providerB: providerLabel(candidateB),
      scores,
      latencyMs,
      notes: notes.trim()
    };
    const runs = [next, ...savedRuns].slice(0, 50);
    setSavedRuns(runs);
    window.localStorage.setItem('voice-lab-runs', JSON.stringify(runs));
  };

  const exportCsv = () => {
    const header = ['Date', 'Scenario', 'Candidate', 'Provider', 'First audio (ms)', ...scoreLabels.map((item) => item.label), 'Average', 'Notes'];
    const rows = savedRuns.flatMap((run) => (['a', 'b'] as CandidateKey[]).map((key) => {
      const candidateScores = run.scores[key];
      return [
        run.createdAt,
        run.scenario,
        key === 'a' ? run.candidateA : run.candidateB,
        key === 'a' ? run.providerA : run.providerB,
        run.latencyMs?.[key] || '',
        ...scoreLabels.map((item) => candidateScores[item.key]),
        average(candidateScores).toFixed(1),
        run.notes
      ];
    }));
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `voice-lab-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sidebar = (
    <Sidebar
      activeNav="voice-lab"
      onNavigateVoice={onNavigateVoice}
      onNavigateChat={onNavigateChat}
      onNavigateVoiceLab={() => undefined}
      onNavigateSkills={onOpenSkills}
      onOpenKnowledgeBase={onOpenKnowledgeBase}
      onOpenUsage={onOpenUsage}
      onOpenEmbedUsage={onOpenEmbedUsage}
      onOpenSettings={onOpenCreateAgent}
    />
  );

  const topBar = (
    <header className="h-16 border-b border-white/10 bg-slate-950/60 backdrop-blur-sm px-6 flex items-center justify-between">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-white/40">
        <span>Agent Workspace</span><ArrowRight className="w-3 h-3" /><span className="text-violet-200">Benchmark</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:block text-sm text-white/60">{vaUser?.email}</span>
        <Button variant="outline" size="sm" onClick={signOut} className="border-white/20 text-white/80">Sign out</Button>
      </div>
    </header>
  );

  return (
    <MainLayout sidebar={sidebar} topBar={topBar}>
      <div className="h-full overflow-y-auto">
        <div className="max-w-[1500px] mx-auto p-6 lg:p-8 space-y-6">
          <section className="relative overflow-hidden rounded-3xl border border-violet-400/20 bg-gradient-to-br from-violet-500/15 via-slate-950/80 to-cyan-500/10 p-7">
            <div className="absolute -right-16 -top-20 w-64 h-64 rounded-full bg-violet-500/10 blur-3xl" />
            <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
              <div>
                <div className="flex items-center gap-2 text-violet-200 text-xs uppercase tracking-[0.3em] mb-3">
                  <FlaskConical className="w-4 h-4" /> Controlled voice testing
                </div>
                <h1 className="text-3xl lg:text-4xl font-semibold text-white font-display">Voice Lab</h1>
                <p className="text-white/60 mt-3 max-w-3xl leading-relaxed">
                  Compare OpenAI Realtime and ElevenLabs with the same agent behavior, script, room, microphone, and scoring rubric. Run each scenario at least three times before declaring a winner.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center">
                  <p className="text-2xl font-semibold text-white">{presets.length}</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Candidates</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-center">
                  <p className="text-2xl font-semibold text-white">{savedRuns.length}</p>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">Saved runs</p>
                </div>
              </div>
            </div>
          </section>

          {error && <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</div>}

          <div className="grid xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)] gap-6 items-start">
            <div className="space-y-6">
              <Card className="p-6 bg-slate-900/60">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">01 · Select candidates</p>
                    <h2 className="text-xl font-semibold text-white mt-1">Set up a fair A/B comparison</h2>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCandidateAId(candidateBId);
                      setCandidateBId(candidateAId);
                    }}
                    disabled={!candidateAId || !candidateBId}
                  >
                    <Shuffle className="w-4 h-4" /> Swap order
                  </Button>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {(['a', 'b'] as CandidateKey[]).map((key) => {
                    const selected = key === 'a' ? candidateA : candidateB;
                    const selectedId = key === 'a' ? candidateAId : candidateBId;
                    return (
                      <div key={key} className={cn('rounded-2xl border p-4', key === 'a' ? 'border-cyan-400/25 bg-cyan-500/5' : 'border-violet-400/25 bg-violet-500/5')}>
                        <div className="flex items-center justify-between mb-3">
                          <span className={cn('text-xs font-semibold uppercase tracking-[0.2em]', key === 'a' ? 'text-cyan-200' : 'text-violet-200')}>Candidate {key.toUpperCase()}</span>
                          <span className="text-[11px] text-white/40">{providerLabel(selected)}</span>
                        </div>
                        <select
                          value={selectedId}
                          onChange={(event) => key === 'a' ? setCandidateAId(event.target.value) : setCandidateBId(event.target.value)}
                          className="w-full rounded-xl bg-slate-950 border border-white/10 text-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                          disabled={isLoading}
                        >
                          <option value="">Select an agent</option>
                          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {providerLabel(preset)}</option>)}
                        </select>
                        <div className="mt-3 flex items-center justify-between text-xs text-white/50">
                          <span>Voice: <span className="text-white/80">{voiceLabel(selected)}</span></span>
                          <span>{selected?.model || '—'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!isLoading && presets.length < 2 && (
                  <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                    Create at least two voice agents—ideally one OpenAI Realtime and one ElevenLabs—to run a useful comparison.
                  </div>
                )}
              </Card>

              <Card className="p-6 bg-slate-900/60">
                <div className="mb-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">02 · Run the same test</p>
                  <h2 className="text-xl font-semibold text-white mt-1">Benchmark script</h2>
                </div>
                <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 mb-5">
                  {scenarios.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setScenarioId(item.id)}
                      className={cn('text-left rounded-xl border p-3 transition', scenarioId === item.id ? 'border-violet-400/60 bg-violet-500/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25')}
                    >
                      <p className="text-sm font-medium text-white">{item.name}</p>
                      <p className="text-xs text-white/40 mt-1">{item.duration}</p>
                    </button>
                  ))}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.25em] text-violet-200">Paste this exact prompt</p>
                      <p className="text-sm text-white/80 mt-3 leading-relaxed">{scenario.prompt}</p>
                    </div>
                    <button onClick={() => copyPrompt('a')} title="Copy prompt" className="shrink-0 p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10">
                      {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Clipboard className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10 flex items-start gap-2 text-xs text-white/50">
                    <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                    <span><strong className="text-white/70">Listen for:</strong> {scenario.watch}</span>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3 mt-4">
                  <Button onClick={() => launchCandidate('a')} disabled={!candidateA} className="bg-cyan-300">
                    <Play className="w-4 h-4" /> Test A · {candidateA?.name || 'Select agent'}
                  </Button>
                  <Button onClick={() => launchCandidate('b')} disabled={!candidateB} className="bg-violet-300 shadow-[0_10px_30px_rgba(196,181,253,0.25)]">
                    <Play className="w-4 h-4" /> Test B · {candidateB?.name || 'Select agent'}
                  </Button>
                </div>
                <p className="text-xs text-white/40 mt-3 text-center">The prompt is copied automatically. Start a fresh session for every candidate and every repeat.</p>
              </Card>

              <Card className="p-6 bg-slate-900/60">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-white/40">03 · Score immediately</p>
                    <h2 className="text-xl font-semibold text-white mt-1">Listening scorecard</h2>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setScores(emptyScores());
                      setLatencyMs({ a: '', b: '' });
                      setNotes('');
                    }}
                  >
                    <RotateCcw className="w-4 h-4" /> Reset
                  </Button>
                </div>
                <div className="space-y-5">
                  {scoreLabels.map((item) => (
                    <div key={item.key} className="grid md:grid-cols-[minmax(150px,1fr)_minmax(160px,1fr)_minmax(160px,1fr)] gap-4 items-center">
                      <div>
                        <p className="text-sm font-medium text-white">{item.label}</p>
                        <p className="text-[11px] text-white/40 mt-0.5">{item.hint}</p>
                      </div>
                      {(['a', 'b'] as CandidateKey[]).map((key) => (
                        <label key={key} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                          <span className="text-xs text-white/50">{key.toUpperCase()}</span>
                          <input
                            type="range"
                            min="1"
                            max="5"
                            step="1"
                            value={scores[key][item.key]}
                            onChange={(event) => updateScore(key, item.key, Number(event.target.value))}
                            className="flex-1 accent-violet-400"
                          />
                          <span className="w-7 h-7 rounded-lg bg-white/10 text-sm font-semibold text-white flex items-center justify-center">{scores[key][item.key]}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-6 pt-5 border-t border-white/10">
                  <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-4 flex items-center justify-between">
                    <span className="text-sm text-white/60">Candidate A average</span><span className="text-2xl font-semibold text-cyan-200">{average(scores.a).toFixed(1)}</span>
                  </div>
                  <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-4 flex items-center justify-between">
                    <span className="text-sm text-white/60">Candidate B average</span><span className="text-2xl font-semibold text-violet-200">{average(scores.b).toFixed(1)}</span>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-4 mt-4">
                  {(['a', 'b'] as CandidateKey[]).map((key) => (
                    <label key={key} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 flex items-center gap-3">
                      <Clock3 className="w-4 h-4 text-white/40" />
                      <span className="text-xs text-white/60">Candidate {key.toUpperCase()} first audio</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={latencyMs[key]}
                        onChange={(event) => setLatencyMs((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder="ms"
                        className="ml-auto w-24 rounded-lg bg-slate-950 border border-white/10 text-white px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                      />
                      <span className="text-xs text-white/35">ms</span>
                    </label>
                  ))}
                </div>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Capture exact moments: first-audio delay, mispronunciations, strong emotional beats, interruption behavior…"
                  className="mt-4 w-full min-h-24 rounded-xl bg-slate-950 border border-white/10 text-white px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-violet-400/50"
                />
                <div className="mt-4 flex justify-end">
                  <Button onClick={saveRun} disabled={!candidateA || !candidateB}><Save className="w-4 h-4" /> Save benchmark run</Button>
                </div>
              </Card>
            </div>

            <aside className="space-y-6 xl:sticky xl:top-6">
              <Card className="p-5 bg-slate-900/70">
                <div className="flex items-center gap-2 mb-4"><Clock3 className="w-4 h-4 text-cyan-200" /><h3 className="font-semibold text-white">Fair-test protocol</h3></div>
                <ol className="space-y-4">
                  {[
                    ['Match the agent', 'Use the same system instructions, tools, and response length. Change only provider and voice.'],
                    ['Control the room', 'Use the same mic, speaker volume, network, and quiet environment.'],
                    ['Alternate order', 'Run A-B, then B-A. This reduces first-impression and network warm-up bias.'],
                    ['Repeat three times', 'Keep the median experience. Do not publish a single lucky or unlucky run.'],
                    ['Separate taste from speed', 'Subjective quality is 1–5. Measure time-to-first-audio separately on video.']
                  ].map(([title, body], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="w-6 h-6 shrink-0 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 text-xs flex items-center justify-center">{index + 1}</span>
                      <div><p className="text-sm font-medium text-white/90">{title}</p><p className="text-xs leading-relaxed text-white/45 mt-1">{body}</p></div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card className="p-5 bg-slate-900/70">
                <div className="flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-violet-200" /><h3 className="font-semibold text-white">Video-ready run of show</h3></div>
                <div className="space-y-3 text-sm text-white/60">
                  <p><span className="text-white font-medium">1.</span> Show both agent configurations and call out what is held constant.</p>
                  <p><span className="text-white font-medium">2.</span> Run natural conversation, emotional range, then interruption.</p>
                  <p><span className="text-white font-medium">3.</span> Keep the latency visible with an on-screen timer or waveform.</p>
                  <p><span className="text-white font-medium">4.</span> Reveal this scorecard and explain where each voice wins—not just one overall winner.</p>
                </div>
              </Card>

              <Card className="p-5 bg-slate-900/70">
                <div className="flex items-center justify-between mb-4">
                  <div><p className="text-xs uppercase tracking-[0.2em] text-white/40">Results</p><h3 className="font-semibold text-white mt-1">Recent runs</h3></div>
                  <Button variant="ghost" size="xs" onClick={exportCsv} disabled={!savedRuns.length}><Download className="w-4 h-4" /> CSV</Button>
                </div>
                {savedRuns.length === 0 ? (
                  <p className="text-xs text-white/40 py-4">No scored runs yet. Your saved comparisons will appear here.</p>
                ) : (
                  <div className="space-y-2">
                    {savedRuns.slice(0, 5).map((run) => (
                      <div key={run.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3"><p className="text-xs font-medium text-white truncate">{run.scenario}</p><span className="text-[10px] text-white/35">{new Date(run.createdAt).toLocaleDateString()}</span></div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="text-white/50 truncate">A · {run.candidateA} <span className="text-cyan-200 font-semibold">{average(run.scores.a).toFixed(1)}</span></div>
                          <div className="text-white/50 truncate">B · {run.candidateB} <span className="text-violet-200 font-semibold">{average(run.scores.b).toFixed(1)}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </aside>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
