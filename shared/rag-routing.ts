const BOUNDED_OR_NAVIGATION_TASK = [
  /\b(?:return only|format|rewrite|rephrase|extract|classify|summarize into|shopping brief)\b/,
  /\b(?:query|search|check|look up|fetch|retrieve)\b[^.\n]*\b(?:supabase|database|catalog|profile|preferences|purchases|orders|returns|account)\b/,
  /\b(?:before i (?:spend|pay|buy)|before (?:paying|purchasing)|pre-purchase)\b/,
  /\b(?:take me to|open|show me|give me|send me)\b[^.\n]*\b(?:product|storefront|page|link)\b/
] as const;

const KNOWLEDGE_DETAIL = /\b(?:compare|difference|trade-?off|construction|material|toe(?: room| shape)?|break-?in|all-day comfort|eight-hour comfort|weather|rain|water resistance|care|styling|longevity|durability|resolva(?:ble|bility)|product details?|knowledge|documentation|manual|policy|article)\b/;
const KNOWLEDGE_QUESTION = /\b(?:why|how|explain|tell me about|what (?:is|are|does)|which is better)\b/;
const KNOWLEDGE_SUBJECT = /\b(?:product|shoe|shoes|footwear|boot|boots|loafer|derby|runner|sneaker|oxford|mule|slingback|heel|sandal|flat|policy|procedure|treatment|coverage|documentation)\b/;

export function shouldRunRagForTurn(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (BOUNDED_OR_NAVIGATION_TASK.some((pattern) => pattern.test(normalized))) return false;
  if (KNOWLEDGE_DETAIL.test(normalized)) return true;
  return KNOWLEDGE_QUESTION.test(normalized) && KNOWLEDGE_SUBJECT.test(normalized);
}
