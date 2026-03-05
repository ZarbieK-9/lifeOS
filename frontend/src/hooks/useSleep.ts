// Sleep detection — CONTEXT.md §1: accelerometer + gyroscope
// When device is still for >5 min → classify as asleep
// On sleep: trigger night routine (focus mode + day review notification)
// On wake: trigger morning routine (day preview notification)

import { useEffect, useRef } from 'react';
import { Accelerometer } from 'expo-sensors';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';
import { triggerMorningRoutine, triggerNightRoutine } from '../services/sleepRoutines';

const THRESHOLD = 0.15;
const CONFIRM_MS = 5 * 60 * 1000; // 5 min stillness

export function useSleep() {
  const setSleep = useStore(s => s.setSleep);
  const sleep = useStore(s => s.sleep);
  const stillSince = useRef<number | null>(null);
  const wasAsleep = useRef(sleep.isAsleep);

  useEffect(() => {
    let sub: ReturnType<typeof Accelerometer.addListener> | null = null;

    (async () => {
      if (!(await Accelerometer.isAvailableAsync())) return;
      Accelerometer.setUpdateInterval(2000);

      sub = Accelerometer.addListener(({ x, y, z }) => {
        const mag = Math.sqrt(x * x + y * y + z * z);
        const dev = Math.abs(mag - 1.0);

        if (dev < THRESHOLD) {
          if (!stillSince.current) stillSince.current = Date.now();
          const dur = Date.now() - stillSince.current;

          if (dur >= CONFIRM_MS && !wasAsleep.current) {
            wasAsleep.current = true;
            const now = dayjs().toISOString();
            setSleep({ isAsleep: true, sleepStart: now, sleepEnd: null, durationMinutes: 0 });

            // Night routine: focus mode + day review notification
            triggerNightRoutine();
          }
        } else {
          if (wasAsleep.current) {
            const start = useStore.getState().sleep.sleepStart;
            const mins = start ? dayjs().diff(dayjs(start), 'minute') : 0;
            wasAsleep.current = false;
            setSleep({ isAsleep: false, sleepEnd: dayjs().toISOString(), durationMinutes: mins });

            // Morning routine: day preview notification
            triggerMorningRoutine();
          }
          stillSince.current = null;
        }
      });
    })();

    return () => { sub?.remove(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
