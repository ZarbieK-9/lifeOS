// Background tasks — teaser notifications when app is closed
// Full AI pipeline requires foreground; background only sends lightweight nudges.

import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import dayjs from 'dayjs';
import { kv } from '../db/mmkv';

const BACKGROUND_TASK_NAME = 'LIFEOS_PROACTIVE_BG';

TaskManager.defineTask(BACKGROUND_TASK_NAME, async () => {
  try {
    const enabled = kv.getBool('proactive_ai_enabled') ?? true;
    if (!enabled) return BackgroundTask.BackgroundTaskResult.Failed;

    const hour = dayjs().hour();
    const today = dayjs().format('YYYY-MM-DD');
    const { sendProactiveNotification } = await import('./notifications');

    // Morning teaser (5-10am)
    const morningFired = kv.getString('proactive_last_morning');
    const morningDone = morningFired && dayjs(morningFired).isSame(dayjs(), 'day');
    if (hour >= 5 && hour < 10 && !morningDone) {
      kv.set(`proactive_morning_${today}`, '1');
      await sendProactiveNotification(
        'Good Morning!',
        'Your daily briefing is ready — tap to see it'
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Midday hydration nudge (11am-3pm, once per day)
    const hydrationNudgeKey = `bg_hydration_nudge_${today}`;
    if (hour >= 11 && hour < 15 && !kv.getString(hydrationNudgeKey)) {
      const hydrationToday = kv.getNumber('hydration_today') ?? 0;
      const goal = kv.getNumber('hydration_goal_ml') ?? 2500;
      if (hydrationToday < goal * 0.5) {
        kv.set(hydrationNudgeKey, '1');
        const remaining = goal - hydrationToday;
        await sendProactiveNotification(
          'Hydration Reminder',
          `You've had ${hydrationToday}ml so far — ${remaining}ml to go!`
        );
        return BackgroundTask.BackgroundTaskResult.Success;
      }
    }

    // Afternoon task nudge (2-5pm, once per day)
    const taskNudgeKey = `bg_task_nudge_${today}`;
    if (hour >= 14 && hour < 17 && !kv.getString(taskNudgeKey)) {
      kv.set(taskNudgeKey, '1');
      await sendProactiveNotification(
        'Task Check-in',
        'How are your tasks going? Tap to review what\'s left today'
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // Evening teaser (7-11pm)
    const eveningFired = kv.getString('proactive_last_evening');
    const eveningDone = eveningFired && dayjs(eveningFired).isSame(dayjs(), 'day');
    if (hour >= 19 && hour < 23 && !eveningDone) {
      kv.set(`proactive_evening_${today}`, '1');
      await sendProactiveNotification(
        'Evening Reflection',
        'Ready to review your day? Tap to see your summary'
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[BackgroundTask] Error:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Register the background task.
 * Should be called once during app initialization.
 */
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
      minimumInterval: 30, // 30 minutes
    });
    console.log('[BackgroundTask] Registered successfully');
  } catch (e) {
    console.warn('[BackgroundTask] Registration failed:', e);
  }
}
