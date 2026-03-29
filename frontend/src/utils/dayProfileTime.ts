/** Parse HH:mm (24h). Returns null if invalid. */
export function parseHHmm(s: string | null | undefined): { hour: number; minute: number } | null {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function normalizeHHmm(s: string): string | null {
  const p = parseHHmm(s);
  if (!p) return null;
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Subtract minutes from an HH:mm, wrapping day. */
export function addMinutesToClock(hour: number, minute: number, deltaMin: number): { hour: number; minute: number } {
  let total = hour * 60 + minute + deltaMin;
  total = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}
