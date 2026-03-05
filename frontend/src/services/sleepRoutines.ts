// Sleep-triggered routine summaries — auto morning/night notifications
// Called by useSleep.ts on wake/sleep detection
// Reads store state directly (same pattern as agent/tools.ts)

import * as Notifications from 'expo-notifications';
import dayjs from 'dayjs';
import { useStore } from '../store/useStore';

// ── Debounce: prevent duplicate notifications from brief wake/sleep cycles ──
let lastMorningTrigger = 0;
let lastNightTrigger = 0;
const DEBOUNCE_MS = 30 * 60 * 1000; // 30 minutes

// ── Morning summary ────────────────────────────────

/** Compose a morning summary from current store state */
export async function generateMorningSummary(): Promise<string> {
  const s = useStore.getState();
  const lines: string[] = [];

  // Sleep duration from last night
  if (s.sleep.durationMinutes > 0) {
    const h = Math.floor(s.sleep.durationMinutes / 60);
    const m = s.sleep.durationMinutes % 60;
    lines.push(`You slept ${h}h ${m}m`);
  }

  // Sync fresh Google data if connected
  if (s.isGoogleConnected) {
    try { await s.syncCalendarEvents(); } catch { /* use cached */ }
    try { await s.syncEmails(); } catch { /* use cached */ }
  }

  // Re-read state after potential syncs
  const state = useStore.getState();

  // Today's calendar
  const todayEvents = state.calendarEvents.filter(e =>
    dayjs(e.start_time).isSame(dayjs(), 'day')
  );
  if (todayEvents.length > 0) {
    const eventList = todayEvents.slice(0, 3).map(e => {
      const time = e.all_day ? 'All day' : dayjs(e.start_time).format('h:mm A');
      return `${time} - ${e.summary}`;
    }).join(', ');
    const suffix = todayEvents.length > 3 ? ` (+${todayEvents.length - 3} more)` : '';
    lines.push(`Calendar: ${eventList}${suffix}`);
  } else {
    lines.push('No events today');
  }

  // Pending tasks
  const pendingTasks = state.tasks.filter(t => t.status === 'pending');
  const highPriority = pendingTasks.filter(t => t.priority === 'high');
  if (pendingTasks.length > 0) {
    let taskLine = `${pendingTasks.length} pending task${pendingTasks.length !== 1 ? 's' : ''}`;
    if (highPriority.length > 0) {
      taskLine += ` (${highPriority.length} high priority)`;
    }
    lines.push(taskLine);
  }

  // Unread emails
  if (state.isGoogleConnected && state.unreadEmailCount > 0) {
    lines.push(`${state.unreadEmailCount} unread email${state.unreadEmailCount !== 1 ? 's' : ''}`);
  }

  return lines.join('\n');
}

// ── Night summary ──────────────────────────────────

/** Compose a night summary reviewing the day */
export async function generateNightSummary(): Promise<string> {
  const s = useStore.getState();
  const lines: string[] = [];

  // Tasks completed today vs still pending
  const todayStart = dayjs().startOf('day').toISOString();
  const completedToday = s.tasks.filter(
    t => t.status === 'completed' && t.updated_at >= todayStart
  );
  const stillPending = s.tasks.filter(t => t.status === 'pending');

  if (completedToday.length > 0 || stillPending.length > 0) {
    lines.push(
      `Tasks: ${completedToday.length} completed, ${stillPending.length} still pending`
    );
  }

  // Hydration progress
  const goalMl = s.hydrationGoalMl || 2500;
  const pct = Math.round((s.hydrationTodayMl / goalMl) * 100);
  lines.push(`Hydration: ${s.hydrationTodayMl}ml / ${goalMl}ml (${pct}%)`);

  // Calendar events that occurred today
  if (s.isGoogleConnected) {
    const todayEvents = s.calendarEvents.filter(e =>
      dayjs(e.start_time).isSame(dayjs(), 'day')
    );
    if (todayEvents.length > 0) {
      lines.push(`${todayEvents.length} calendar event${todayEvents.length !== 1 ? 's' : ''} today`);
    }
  }

  return lines.join('\n');
}

// ── Trigger functions ──────────────────────────────

/** Trigger morning routine: generate summary + send notification */
export async function triggerMorningRoutine(): Promise<void> {
  const now = Date.now();
  if (now - lastMorningTrigger < DEBOUNCE_MS) return;
  lastMorningTrigger = now;

  const s = useStore.getState();
  if (!s.autoMorningEnabled) return;

  try {
    const summary = await generateMorningSummary();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Good Morning!',
        body: summary,
        sound: 'default',
      },
      trigger: null,
    });
  } catch (e) {
    console.error('[LifeOS] Morning routine failed:', e);
  }
}

/** Trigger night routine: generate summary + send notification + enable focus */
export async function triggerNightRoutine(): Promise<void> {
  const now = Date.now();
  if (now - lastNightTrigger < DEBOUNCE_MS) return;
  lastNightTrigger = now;

  const s = useStore.getState();
  if (!s.autoNightEnabled) return;

  // Enable focus mode for sleep (consolidated from useSleep.ts)
  if (!s.focusEnabled) {
    s.toggleFocus(480);
  }

  try {
    const summary = await generateNightSummary();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Good Night!',
        body: summary,
        sound: 'default',
      },
      trigger: null,
    });
  } catch (e) {
    console.error('[LifeOS] Night routine failed:', e);
  }
}
