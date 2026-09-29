const TZ = 'America/Chicago';

export function chicagoOffsetMinutes(date: Date): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT';
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

/** Converts a Chicago wall-clock time (YYYY-MM-DD at `hour`:00) to a UTC ISO string. */
export function chicagoLocalToUtcIso(ymd: string, hour: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour);
  let guess = wallClockAsUtc;
  for (let i = 0; i < 2; i += 1) guess = wallClockAsUtc - chicagoOffsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess).toISOString();
}

export function chicagoYmd(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

export function chicagoWeekday(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(new Date(value));
}

export function chicagoMonthDay(value: string | Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'long', day: 'numeric' }).format(new Date(value));
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
