// Smart Hydration Reminder — schedule calculation utilities
// Pure functions for interval math and focus-mode dose redistribution

import dayjs from 'dayjs';

export interface HydrationSchedule {
  intervalMin: number;
  dosePerReminderMl: number;
  totalReminders: number;
  firstReminderAt: string; // ISO string
}

/**
 * Calculate reminder schedule from user parameters.
 * Default: ~10 reminders evenly spaced across the time window.
 */
export function calculateSchedule(
  startHour: number,
  endHour: number,
  goalMl: number,
  alreadyDrankMl = 0,
  customIntervalMin?: number,
): HydrationSchedule {
  const totalMinutes = (endHour - startHour) * 60;

  let intervalMin: number;
  let totalReminders: number;

  if (customIntervalMin && customIntervalMin > 0) {
    intervalMin = customIntervalMin;
    totalReminders = Math.max(1, Math.floor(totalMinutes / intervalMin));
  } else {
    // Default: aim for ~10 reminders
    totalReminders = 10;
    intervalMin = Math.floor(totalMinutes / totalReminders);
  }

  const remainingMl = Math.max(0, goalMl - alreadyDrankMl);
  const dosePerReminderMl = Math.round(remainingMl / Math.max(1, totalReminders));

  // First reminder: either startHour today or next interval from now
  const now = dayjs();
  const todayStart = now.startOf('day');
  const windowStart = todayStart.add(startHour, 'hour');

  let firstReminderAt: dayjs.Dayjs;
  if (now.isBefore(windowStart)) {
    firstReminderAt = windowStart;
  } else {
    // Next interval boundary from now
    const minutesSinceStart = now.diff(windowStart, 'minute');
    const slotsPassed = Math.floor(minutesSinceStart / intervalMin);
    firstReminderAt = windowStart.add((slotsPassed + 1) * intervalMin, 'minute');
  }

  return {
    intervalMin,
    dosePerReminderMl,
    totalReminders,
    firstReminderAt: firstReminderAt.toISOString(),
  };
}

/**
 * Recalculate dose after focus mode ends.
 * Distributes remaining water across remaining time slots.
 */
export function recalculateAfterFocus(
  endHour: number,
  goalMl: number,
  todayMl: number,
  intervalMin: number,
): { newDosePerReminder: number; remainingSlots: number } {
  const now = dayjs();
  const windowEnd = now.startOf('day').add(endHour, 'hour');
  const minutesLeft = Math.max(0, windowEnd.diff(now, 'minute'));
  const remainingSlots = Math.max(1, Math.floor(minutesLeft / intervalMin));
  const remainingMl = Math.max(0, goalMl - todayMl);
  const newDosePerReminder = Math.round(remainingMl / remainingSlots);

  return { newDosePerReminder, remainingSlots };
}
