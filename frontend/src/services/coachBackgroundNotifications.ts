// Coach-aligned notifications for background task (no LLM).
// Requires store init so patterns, calendar cache, tasks, mood, etc. are available.

import dayjs from 'dayjs';
import { kv } from '../db/mmkv';
import { useStore } from '../store/useStore';
import { sendProactiveNotification } from './notifications';
import {
  generateMorningPlan,
  persistMorningPlan,
  loadMorningPlanForToday,
  formatMorningPlanNotificationBody,
  generateWeeklyReview,
  formatWeeklyCoachBody,
} from '../agent/coaching';
import { generateDailyReflection, formatEveningCoach } from '../agent/reflection';

const TAG = '[CoachBG]';

/**
 * Run morning / evening / weekly coach notifications when the app is not in foreground.
 * Uses the same copy as the watcher (deterministic). Dedupes per day/week via MMKV.
 * @returns true if a notification was sent
 */
export async function runCoachAlignedBackgroundNotifications(): Promise<boolean> {
  try {
    await useStore.getState().init();
  } catch (e) {
    console.warn(TAG, 'init failed', e);
    return false;
  }

  if (!useStore.getState().ready) {
    console.warn(TAG, 'store not ready');
    return false;
  }

  const hour = dayjs().hour();
  const dow = dayjs().day();
  const today = dayjs().format('YYYY-MM-DD');

  if (!(kv.getBool('notification_permission') ?? false)) {
    return false;
  }

  // Morning coach window (align with watcher morning_coach 7–10)
  if (hour >= 7 && hour <= 10) {
    const sentKey = `bg_coach_morning_sent_${today}`;
    if (kv.getString(sentKey)) return false;

    if (loadMorningPlanForToday()) {
      kv.set(sentKey, '1');
      return false;
    }

    try {
      const plan = await generateMorningPlan();
      persistMorningPlan(plan);
      const body = formatMorningPlanNotificationBody(plan);
      await sendProactiveNotification('Your morning plan is ready', body);
      kv.set(sentKey, '1');
      console.log(TAG, 'morning coach notification sent');
      return true;
    } catch (e) {
      console.warn(TAG, 'morning coach failed', e);
    }
  }

  // Evening coach (20–23) — runs even when generic nudges are in quiet hours
  if (hour >= 20 && hour <= 23) {
    const sentKey = `bg_coach_evening_sent_${today}`;
    if (kv.getString(sentKey)) return false;

    try {
      const reflection = await generateDailyReflection();
      const body = formatEveningCoach(reflection);
      await sendProactiveNotification(`Evening coach · ${reflection.score}/100`, body);
      kv.set(sentKey, '1');
      console.log(TAG, 'evening coach notification sent');
      return true;
    } catch (e) {
      console.warn(TAG, 'evening coach failed', e);
    }
  }

  // Weekly coach — Sunday 19–21 (one notification per Sunday)
  if (dow === 0 && hour >= 19 && hour <= 21) {
    const sentKey = `bg_coach_weekly_sent_${today}`;
    if (kv.getString(sentKey)) return false;

    try {
      const review = await generateWeeklyReview();
      const body = formatWeeklyCoachBody(review);
      await sendProactiveNotification('Your week in review', body);
      kv.set(sentKey, '1');
      console.log(TAG, 'weekly coach notification sent');
      return true;
    } catch (e) {
      console.warn(TAG, 'weekly coach failed', e);
    }
  }

  return false;
}
