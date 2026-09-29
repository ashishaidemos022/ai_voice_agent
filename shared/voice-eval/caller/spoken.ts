const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)];
}

function yearWords(year: number): string {
  const high = Math.floor(year / 100);
  const low = year % 100;
  if (year === 2000) return 'two thousand';
  if (year > 2000 && year < 2010) return `two thousand ${ONES[low]}`;
  if (low === 0) return `${twoDigits(high)} hundred`;
  return `${twoDigits(high)} ${low < 10 ? `oh ${ONES[low]}` : twoDigits(low)}`;
}

/**
 * The caller's TTS model (eleven_flash_v2_5) reads digit strings without text normalization and garbles
 * them ("1988" came out as "19 8"). Rewrite years and letter-digit codes the way a caller says them.
 * Only the audio uses this; transcripts and scoring keep the original text.
 */
export function spokenForTts(text: string): string {
  return text.replace(/\b[A-Za-z0-9]+\b/g, (token) => {
    if (/^(19|20)\d{2}$/.test(token)) return yearWords(Number(token));
    if (/^\d+(st|nd|rd|th)$/i.test(token)) return token;
    if (/\d/.test(token) && /[A-Za-z]/.test(token)) {
      return [...token].map((ch) => (/\d/.test(ch) ? ONES[Number(ch)] : ch.toUpperCase())).join(' ');
    }
    return token;
  });
}
