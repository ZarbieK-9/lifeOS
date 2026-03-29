// Fixed-time local notifications for coach windows (complements watcher + background task).
// Uses device-local timezone. Best-effort delivery when the app has not run JS recently.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { hasNotificationPermission } from './notifications';

const isExpoGo = Constants.appOwnership === 'expo';

export const COACH_SCHEDULE_IDS = {
  morning: 'lifeos_coach_sched_morning',
  evening: 'lifeos_coach_sched_evening',
  weekly: 'lifeos_coach_sched_weekly',
} as const;

/** Default local times (device clock): morning 8:00, evening 21:00, weekly Sunday 19:30 */
export async function registerScheduledCoachNotifications(): Promise<void> {
  if (isExpoGo) return;
  if (!hasNotificationPermission()) return;

  for (const id of Object.values(COACH_SCHEDULE_IDS)) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }

  const androidContent = Platform.OS === 'android' ? { channelId: 'proactive' as const } : {};
  const androidTrigger =
    Platform.OS === 'android' ? { channelId: 'proactive' as const } : {};

  await Notifications.scheduleNotificationAsync({
    identifier: COACH_SCHEDULE_IDS.morning,
    content: {
      title: 'Your morning plan is ready',
      body: 'Open LifeOS for priorities, risks, and your coach note.',
      data: { type: 'coach_scheduled', kind: 'morning' },
      categoryIdentifier: 'proactive_basic',
      ...androidContent,
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: 8,
      minute: 0,
      ...androidTrigger,
    },
  });

  await Notifications.scheduleNotificationAsync({
    identifier: COACH_SCHEDULE_IDS.evening,
    content: {
      title: 'Evening coach',
      body: 'Review your day — score, reflection, and one thing to try tomorrow.',
      data: { type: 'coach_scheduled', kind: 'evening' },
      categoryIdentifier: 'proactive_basic',
      ...androidContent,
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DAILY,
      hour: 21,
      minute: 0,
      ...androidTrigger,
    },
  });

  // Sunday — weekday 1 (see expo-notifications WeeklyTriggerInput)
  await Notifications.scheduleNotificationAsync({
    identifier: COACH_SCHEDULE_IDS.weekly,
    content: {
      title: 'Weekly coach',
      body: 'Your week in review — trends, wins, and one focus for next week.',
      data: { type: 'coach_scheduled', kind: 'weekly' },
      categoryIdentifier: 'proactive_basic',
      ...androidContent,
    },
    trigger: {
      type: SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1,
      hour: 19,
      minute: 30,
      ...androidTrigger,
    },
  });
}

export async function cancelScheduledCoachNotifications(): Promise<void> {
  if (isExpoGo) return;
  for (const id of Object.values(COACH_SCHEDULE_IDS)) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }
}
