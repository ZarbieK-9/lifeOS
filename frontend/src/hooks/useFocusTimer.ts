// Focus mode countdown — ticks every minute while active
// Sends notification on completion (UI_UX.md §6)

import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useStore } from '../store/useStore';

export function useFocusTimer() {
  const enabled = useStore(s => s.focusEnabled);
  const remaining = useStore(s => s.focusRemainingMin);
  const duration = useStore(s => s.focusDurationMin);
  const tick = useStore(s => s.tickFocus);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enabled && remaining > 0) {
      timer.current = setInterval(() => {
        const r = useStore.getState().focusRemainingMin;
        if (r <= 1) {
          tick();
          Notifications.scheduleNotificationAsync({
            content: { title: 'Focus Complete', body: `You focused for ${duration} minutes.` },
            trigger: null,
          }).catch(() => {});
          if (timer.current) clearInterval(timer.current);
        } else {
          tick();
        }
      }, 60_000);
    }
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
