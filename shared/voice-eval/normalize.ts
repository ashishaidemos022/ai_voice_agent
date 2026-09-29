import type { Fact } from './types.ts';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9'
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ISO_RE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
const SLASH_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const MONTH_RE = new RegExp(`\\b(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');

export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function normalizeName(value: string): string {
  return tokenize(value).join(' ');
}

export function normalizeDigits(value: string): string {
  return tokenize(value).map((token) => (/^\d+$/.test(token) ? token : DIGIT_WORDS[token] ?? '')).join('');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoIfValid(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDate() === day ? iso : null;
}

export function extractDates(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(ISO_RE)) {
    const iso = isoIfValid(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.push(iso);
  }
  for (const m of text.matchAll(SLASH_RE)) {
    const iso = isoIfValid(Number(m[3]), Number(m[1]), Number(m[2]));
    if (iso) found.push(iso);
  }
  for (const m of text.matchAll(MONTH_RE)) {
    const iso = isoIfValid(Number(m[3]), MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]));
    if (iso) found.push(iso);
  }
  return found;
}

export function normalizeDate(value: string): string | null {
  return extractDates(value.trim())[0] ?? null;
}

export function normalizeWeekday(value: string): string | null {
  const tokens = tokenize(value);
  return WEEKDAYS.find((day) => tokens.includes(day.toLowerCase())) ?? null;
}

function digitToken(token: string): string | null {
  return /^\d+$/.test(token) ? token : DIGIT_WORDS[token] ?? null;
}

// Maximal runs of consecutive digit tokens (numerals or digit words); any other token breaks a run.
function digitRuns(text: string): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const token of tokenize(text)) {
    const digits = digitToken(token);
    if (digits === null) {
      if (current.length > 0) runs.push(current);
      current = [];
    } else {
      current.push(digits);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

// True when some contiguous slice of whole tokens in the run concatenates to exactly the needle.
function runContains(run: string[], needle: string): boolean {
  for (let start = 0; start < run.length; start += 1) {
    let joined = '';
    for (let end = start; end < run.length && joined.length < needle.length; end += 1) {
      joined += run[end];
      if (joined === needle) return true;
    }
  }
  return false;
}

export function factMatchesText(fact: Fact, text: string): boolean {
  switch (fact.kind) {
    case 'name':
    case 'text': {
      const needle = normalizeName(fact.value);
      return needle.length > 0 && ` ${tokenize(text).join(' ')} `.includes(` ${needle} `);
    }
    case 'date': {
      const iso = normalizeDate(fact.value);
      return iso !== null && extractDates(text).includes(iso);
    }
    case 'digits': {
      const needle = normalizeDigits(fact.value);
      return needle.length > 0 && digitRuns(text).some((run) => runContains(run, needle));
    }
    case 'weekday': {
      const day = normalizeWeekday(fact.value);
      return day !== null && tokenize(text).includes(day.toLowerCase());
    }
  }
}

export function factMatchesValue(fact: Fact, value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value);
  switch (fact.kind) {
    case 'name':
    case 'text':
      return normalizeName(text).length > 0 && normalizeName(text) === normalizeName(fact.value);
    case 'date': {
      const actual = normalizeDate(text);
      return actual !== null && actual === normalizeDate(fact.value);
    }
    case 'digits': {
      const actual = normalizeDigits(text);
      return actual.length > 0 && actual === normalizeDigits(fact.value);
    }
    case 'weekday': {
      const actual = normalizeWeekday(text);
      return actual !== null && actual === normalizeWeekday(fact.value);
    }
  }
}

export function wordEditDistance(a: string[], b: string[]): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

export function factTokens(fact: Fact): string[] {
  if (fact.kind === 'digits') return normalizeDigits(fact.value).split('');
  if (fact.kind === 'date') return (normalizeDate(fact.value) ?? '').split('-').filter(Boolean);
  return tokenize(fact.value);
}

export function transcriptTokensFor(fact: Fact, text: string): string[] {
  if (fact.kind === 'digits') return normalizeDigits(text).split('');
  if (fact.kind === 'date') return extractDates(text).flatMap((date) => date.split('-'));
  return tokenize(text);
}

// Semi-global alignment: the reference may start and end anywhere in the hypothesis
// (leading/trailing hypothesis tokens are free), so insertions inside the entity cost 1 each.
export function bestWindowDistance(reference: string[], hypothesis: string[]): number {
  if (reference.length === 0) return 0;
  let previous = new Array<number>(hypothesis.length + 1).fill(0);
  for (let i = 1; i <= reference.length; i += 1) {
    const current = new Array<number>(hypothesis.length + 1);
    current[0] = i;
    for (let j = 1; j <= hypothesis.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous.reduce((best, value) => Math.min(best, value), Number.POSITIVE_INFINITY);
}
