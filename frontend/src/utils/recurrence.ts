// Recurrence helper — calculates the next due date for recurring tasks

import dayjs from 'dayjs';
import parser from 'cron-parser';

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** True if the string looks like a cron expression (e.g. "0 9 * * 1" or "0 9 * * MON"). */
function looksLikeCron(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(/\s+/);
  return parts.length >= 5 && parts.every((p) => /^[\d*,\-/A-Za-z]+$/.test(p));
}

/**
 * Calculate the next due date based on a recurrence pattern.
 * Supports: cron expressions (e.g. "0 9 * * 1" for Mon 9am), "daily", "weekly",
 *           "every weekday", "every Monday", "every N days/weeks"
 */
export function calculateNextDueDate(recurrence: string, currentDue: string): string {
  const trimmed = recurrence.trim();
  if (!trimmed) return dayjs(currentDue).add(1, 'day').toISOString();

  if (looksLikeCron(trimmed)) {
    try {
      const from = dayjs(currentDue).isBefore(dayjs(), 'minute') ? dayjs() : dayjs(currentDue);
      const interval = parser.parseExpression(trimmed, { currentDate: from.toDate() });
      const next = interval.next().toDate();
      return dayjs(next).toISOString();
    } catch {
      // fall through to natural language
    }
  }

  const base = dayjs(currentDue);
  const lower = trimmed.toLowerCase();

  // "daily" or "every day"
  if (lower === 'daily' || lower === 'every day') {
    return base.add(1, 'day').toISOString();
  }

  // "weekly"
  if (lower === 'weekly') {
    return base.add(1, 'week').toISOString();
  }

  // "every weekday"
  if (lower === 'every weekday') {
    let next = base.add(1, 'day');
    while (next.day() === 0 || next.day() === 6) {
      next = next.add(1, 'day');
    }
    return next.toISOString();
  }

  // "every Monday", "every Tuesday", etc.
  const dayMatch = lower.match(/^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
  if (dayMatch) {
    const targetDay = DAY_MAP[dayMatch[1]];
    let next = base.add(1, 'day');
    while (next.day() !== targetDay) {
      next = next.add(1, 'day');
    }
    return next.toISOString();
  }

  // "every N days/hours/weeks"
  const intervalMatch = lower.match(/^every\s+(\d+)\s+(days?|hours?|weeks?)$/);
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2].replace(/s$/, '') as 'day' | 'hour' | 'week';
    return base.add(n, unit).toISOString();
  }

  // Fallback: add 1 day
  return base.add(1, 'day').toISOString();
}
