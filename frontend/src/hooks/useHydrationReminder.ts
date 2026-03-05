// Smart Hydration Reminder — ticks every 60s
// Checks time window, focus mode, fires notifications, redistributes skipped doses

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';

export function useHydrationReminder() {
  const reminderEnabled = useStore(s => s.hydrationReminderEnabled);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!reminderEnabled) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }

    timer.current = setInterval(() => {
      const s = useStore.getState();
      if (!s.hydrationReminderEnabled) return;

      const now = dayjs();
      const todayStart = now.startOf('day');
      const windowStart = todayStart.add(s.hydrationStartHour, 'hour');
      const windowEnd = todayStart.add(s.hydrationEndHour, 'hour');

      // Outside the active window
      if (now.isBefore(windowStart) || now.isAfter(windowEnd)) return;

      // Goal already met
      if (s.hydrationTodayMl >= s.hydrationGoalMl) return;

      // Check if it's time for the next reminder
      const nextAt = s.nextHydrationReminderAt;
      if (!nextAt || now.isBefore(dayjs(nextAt))) return;

      // It's reminder time
      if (s.focusEnabled) {
        // Focus active: skip this dose, accumulate
        s.skipHydrationDose(s.hydrationDosePerReminder);
      } else {
        // Calculate actual dose (normal + any accumulated from skips)
        const dose = s.hydrationDosePerReminder + s.hydrationSkippedMl;

        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Time to Hydrate',
            body: `Drink ${dose}ml of water (${s.hydrationTodayMl}ml / ${s.hydrationGoalMl}ml today)`,
            sound: 'default',
          },
          trigger: null,
        }).catch(() => {});

        // Clear accumulated skipped dose
        if (s.hydrationSkippedMl > 0) {
          s.clearSkippedDose();
        }
      }

      // Advance to next reminder slot
      s.advanceHydrationReminder();
    }, 60_000);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [reminderEnabled]);
}
