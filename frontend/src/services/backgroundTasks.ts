// Background tasks — lightweight watcher evaluation when app is closed.
// Runs anomaly detection + high-priority rules without loading LLM.
// Sends push notifications for actionable insights.

import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import dayjs from 'dayjs';
import { kv } from '../db/mmkv';

const BACKGROUND_TASK_NAME = 'LIFEOS_PROACTIVE_BG';

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const enabled = kv.getBool('proactive_ai_enabled') ?? true;
    if (!enabled) return BackgroundTask.BackgroundTaskResult.Failed;

    // Best effort queue drain to reduce server-state lag while app stays backgrounded.
    try {
      const { useStore } = await import('../store/useStore');
      await useStore.getState().drainQueue();
    } catch {
      /* ignore */
    }

    const hour = dayjs().hour();
    const quietAfter = kv.getNumber('proactive_quiet_after_hour') ?? 21;
    const quietBefore = kv.getNumber('proactive_quiet_before_hour') ?? 7;

    // Coach-aligned morning / evening / weekly (same copy as watcher) — run first; may use quiet hours for evening/weekly
    try {
      const { runCoachAlignedBackgroundNotifications } = await import('./coachBackgroundNotifications');
      const sentCoach = await runCoachAlignedBackgroundNotifications();
      if (sentCoach) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    } catch (e) {
      console.warn('[BackgroundTask] coach-aligned:', e);
    }

    try {
      const { runDayProfileLateNudge } = await import('./dayProfileNotifications');
      if (await runDayProfileLateNudge()) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    } catch (e) {
      console.warn('[BackgroundTask] day-profile:', e);
    }

    // Respect quiet hours for generic anomaly / hydration fallbacks
    if (hour >= quietAfter || hour < quietBefore) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const { sendProactiveNotification } = await import('./notifications');
    const today = dayjs().format('YYYY-MM-DD');

    // Try lightweight watcher evaluation (anomaly detection + state checks)
    try {
      const { detectAnomalies } = await import('../agent/patterns');
      const anomalies = await detectAnomalies();

      for (const anomaly of anomalies) {
        if (anomaly.severity !== 'high') continue;

        // Deduplicate — only send once per anomaly type per day
        const dedupeKey = `bg_anomaly_${anomaly.description}_${today}`;
        if (kv.getString(dedupeKey)) continue;
        kv.set(dedupeKey, '1');

        const titles: Record<string, string> = {
          hydration_behind_pace: 'Behind on water',
          past_usual_bedtime: 'Past your bedtime',
          overdue_tasks: 'Overdue tasks',
          unusual_spending: 'Unusual spending',
        };
        const title = titles[anomaly.description] ?? anomaly.description.replace(/_/g, ' ');
        const body = formatAnomalyForNotification(anomaly);

        await sendProactiveNotification(title, body);
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    } catch {
      // Anomaly detection failed (DB not ready, etc.) — fall back to basic nudges
    }

    const hydrationKey = `bg_hydration_${today}`;
    if (hour >= 11 && hour < 15 && !kv.getString(hydrationKey)) {
      const todayMl = kv.getNumber('hydration_today') ?? 0;
      const goal = kv.getNumber('hydration_goal_ml') ?? 2500;
      if (todayMl < goal * 0.5) {
        kv.set(hydrationKey, '1');
        await sendProactiveNotification('Hydration Reminder', `${todayMl}ml so far — ${goal - todayMl}ml to go!`);
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[BackgroundTask] Error:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

function formatAnomalyForNotification(anomaly: { description: string; data: Record<string, unknown> }): string {
  switch (anomaly.description) {
    case 'hydration_behind_pace':
      return `${anomaly.data.todayMl}ml so far, should be ~${anomaly.data.expectedMl}ml. Time to catch up!`;
    case 'overdue_tasks': {
      const titles = (anomaly.data.titles as string[]) ?? [];
      return titles.length > 0 ? `${titles.join(', ')} — overdue` : `${anomaly.data.count} tasks overdue`;
    }
    case 'unusual_spending':
      return `$${(anomaly.data.todaySpend as number).toFixed(2)} today — ${anomaly.data.ratio}x your average`;
    default:
      return 'Tap to check your status';
  }
}

export async function registerBackgroundFetch(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.log('[BackgroundTask] Restricted by user settings');
      return;
    }

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK_NAME);
    if (isRegistered) return;

    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK_NAME, {
      minimumInterval: 15, // 15 minutes (more frequent for proactive intelligence)
    });
    console.log('[BackgroundTask] Registered successfully');
  } catch (e) {
    console.warn('[BackgroundTask] Registration failed:', e);
  }
}
