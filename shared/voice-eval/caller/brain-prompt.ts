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
    '- Otherwise choose action "say" and put your next line in text.',
    ...(scenario.beats.length
      ? ['- Some moments in this call are scripted and will be spoken for you (for example a correction, an interruption, a pause, or mentioning a symptom). Never perform those yourself; just continue naturally after they happen.']
      : []),
    ...hiddenFacts.map((fact) => `- You have not changed your mind yet: do not mention or ask for any alternative to your first stated preference (${fact}) until you have said so in the conversation.`)
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
