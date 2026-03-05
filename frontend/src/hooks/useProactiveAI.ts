// useProactiveAI — Core scheduling hook for proactive AI messages
// Two trigger types:
//   1. Scheduled: morning briefing, check-ins, evening reflection (60s poll)
//   2. Event-driven: calendar alerts (15 min before), new email detection (2 min poll)
// Deduplicates via MMKV timestamps.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import dayjs from 'dayjs';
import { kv } from '../db/mmkv';
import { useStore } from '../store/useStore';
import type { ProactiveType } from '../agent/agent';

const SCHEDULE_INTERVAL_MS = 60_000; // 60s — scheduled triggers
const EVENT_INTERVAL_MS = 120_000; // 2 min — event-driven triggers
const USER_ACTIVE_COOLDOWN_MS = 60 * 60_000; // 1 hour
const CALENDAR_GAP_MIN = 30;
const CALENDAR_GAP_MAX_MIN = 60;
const CALENDAR_ALERT_WINDOW_MIN = 15; // alert 15 min before event
const EMAIL_COOLDOWN_MS = 10 * 60_000; // 10 min between email alerts

// ── MMKV helpers ───────────────────────────────────────

function wasFiredToday(type: 'morning' | 'evening'): boolean {
  const ts = kv.getString(`proactive_last_${type}`);
  if (!ts) return false;
  return dayjs(ts).isSame(dayjs(), 'day');
}

function markFired(type: 'morning' | 'evening'): void {
  kv.set(`proactive_last_${type}`, dayjs().toISOString());
}

function getLastCheckinTime(): number {
  const ts = kv.getString('proactive_last_checkin');
  return ts ? new Date(ts).getTime() : 0;
}

function getLastUserInteraction(): number {
  const ts = kv.getString('last_user_ai_interaction');
  return ts ? new Date(ts).getTime() : 0;
}

function getLastEmailAlertTime(): number {
  const ts = kv.getString('proactive_last_email_alert');
  return ts ? new Date(ts).getTime() : 0;
}

function getAlertedEventIds(): Set<string> {
  const raw = kv.getString('proactive_alerted_events');
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw)); } catch { return new Set(); }
}

function addAlertedEventId(eventId: string): void {
  const ids = getAlertedEventIds();
  ids.add(eventId);
  // Keep only today's alerts — reset if set gets too large
  if (ids.size > 50) ids.clear();
  kv.set('proactive_alerted_events', JSON.stringify([...ids]));
}

function getLastSeenEmailId(): string | null {
  return kv.getString('proactive_last_seen_email') ?? null;
}

function setLastSeenEmailId(id: string): void {
  kv.set('proactive_last_seen_email', id);
}

// ── Scheduled trigger detection ────────────────────────

function detectScheduledTrigger(): 'morning' | 'checkin' | 'evening' | null {
  const hour = dayjs().hour();
  const now = Date.now();
  const state = useStore.getState();
  const checkinIntervalMs = (state.checkinIntervalMin || 90) * 60_000;
  const quietAfter = state.proactiveQuietAfterHour ?? 21;
  const quietBefore = state.proactiveQuietBeforeHour ?? 7;

  // Quiet hours: no check-in during this window (e.g. after 21:00 or before 07:00). 0,0 = off.
  const quietEnabled = quietAfter !== 0 || quietBefore !== 0;
  const inQuietHours = quietEnabled && (hour >= quietAfter || hour < quietBefore);

  if (hour >= 5 && hour < 10 && !wasFiredToday('morning')) return 'morning';
  if (hour >= 19 && hour < 23 && !wasFiredToday('evening')) return 'evening';

  if (hour >= 8 && hour < 21 && !inQuietHours) {
    const lastCheckin = getLastCheckinTime();
    const lastUserActive = getLastUserInteraction();
    if (now - lastUserActive < USER_ACTIVE_COOLDOWN_MS) return null;
    if (now - lastCheckin >= checkinIntervalMs) return 'checkin';
  }

  return null;
}

// ── Event-driven trigger detection ─────────────────────

interface EventTrigger {
  type: 'calendar_alert' | 'email_alert' | 'calendar_gap';
  detail: string;
  label: string;
}

function getGapFiredToday(): boolean {
  const ts = kv.getString('proactive_last_gap');
  if (!ts) return false;
  return dayjs(ts).isSame(dayjs(), 'day');
}

function markGapFired(): void {
  kv.set('proactive_last_gap', dayjs().toISOString());
}

function detectEventTriggers(): EventTrigger | null {
  const state = useStore.getState();
  const now = dayjs();

  // ── Calendar: alert 15 min before upcoming events ──
  if (state.isGoogleConnected && state.calendarEvents.length > 0) {
    const alertedIds = getAlertedEventIds();
    const sortedEvents = [...state.calendarEvents]
      .filter(e => !e.all_day)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    for (const event of sortedEvents) {
      if (alertedIds.has(event.event_id)) continue;

      const start = dayjs(event.start_time);
      const minutesUntil = start.diff(now, 'minute');

      if (minutesUntil > 0 && minutesUntil <= CALENDAR_ALERT_WINDOW_MIN) {
        addAlertedEventId(event.event_id);
        const timeStr = start.format('h:mm A');
        const detail = `"${event.summary}" starts at ${timeStr} (in ${minutesUntil} min)${event.location ? ` at ${event.location}` : ''}`;
        return {
          type: 'calendar_alert',
          detail,
          label: `${event.summary} in ${minutesUntil}min`,
        };
      }
    }

    // ── Calendar gap: 30–60 min until next event (once per day) ──
    if (!getGapFiredToday()) {
      for (const event of sortedEvents) {
        const start = dayjs(event.start_time);
        const minutesUntil = start.diff(now, 'minute');
        if (minutesUntil >= CALENDAR_GAP_MIN && minutesUntil <= CALENDAR_GAP_MAX_MIN) {
          markGapFired();
          const timeStr = start.format('h:mm A');
          return {
            type: 'calendar_gap',
            detail: `You have ${minutesUntil} min until "${event.summary}" at ${timeStr}.`,
            label: `${minutesUntil} min until ${event.summary}`,
          };
        }
      }
    }
  }

  // ── Email: detect new unread emails ──
  if (state.isGoogleConnected && state.emails.length > 0) {
    const nowMs = Date.now();
    if (nowMs - getLastEmailAlertTime() < EMAIL_COOLDOWN_MS) return null;

    const lastSeenId = getLastSeenEmailId();
    const unread = state.emails.filter(e => e.is_unread);

    if (unread.length > 0) {
      const newestId = unread[0].message_id;
      if (lastSeenId !== newestId) {
        // Find how many are new since last seen
        const lastIdx = lastSeenId ? unread.findIndex(e => e.message_id === lastSeenId) : -1;
        const newEmails = lastIdx === -1 ? unread.slice(0, 5) : unread.slice(0, lastIdx);

        if (newEmails.length > 0) {
          setLastSeenEmailId(newestId);
          kv.set('proactive_last_email_alert', dayjs().toISOString());

          const subjects = newEmails.slice(0, 3).map(e => {
            const from = e.from_address.replace(/<.*>/, '').trim();
            return `"${e.subject}" from ${from}`;
          });
          const extra = newEmails.length > 3 ? ` and ${newEmails.length - 3} more` : '';
          const detail = `${newEmails.length} new email${newEmails.length > 1 ? 's' : ''}: ${subjects.join('; ')}${extra}`;

          return {
            type: 'email_alert',
            detail,
            label: `${newEmails.length} new email${newEmails.length > 1 ? 's' : ''}`,
          };
        }
      }
    }
  }

  return null;
}

// ── Shared execution ───────────────────────────────────

async function fireProactive(
  type: ProactiveType,
  label: string,
  detail?: string,
): Promise<void> {
  try {
    const { runProactive, cleanOutput } = await import('../agent/agent');
    const store = useStore.getState();
    const cmdId = await store.addAiCommand(`[${label}]`, type as any);

    const response = await runProactive({ type, cmdId, detail });
    const cleaned = cleanOutput(response.output);
    await store.resolveAiCommand(cmdId, cleaned, 'executed');

    const { sendProactiveNotification } = await import('../services/notifications');
    await sendProactiveNotification(label, cleaned);
  } catch (e) {
    console.warn(`[ProactiveAI] ${type} failed:`, e);
  }
}

// ── Hook ───────────────────────────────────────────────

export function useProactiveAI() {
  const scheduleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const proactiveEnabled = useStore(s => s.proactiveAIEnabled);
  const isAuthenticated = useStore(s => s.isAuthenticated);
  const isOnline = useStore(s => s.isOnline);
  const ready = useStore(s => s.ready);
  const isGoogleConnected = useStore(s => s.isGoogleConnected);
  const hasLlm = useStore(s => s.llmModelPath !== null);

  // Can run AI: online+authenticated OR local LLM available
  const canRunAI = (isAuthenticated && isOnline) || hasLlm;

  // Scheduled triggers (morning/checkin/evening) — 60s interval
  useEffect(() => {
    if (!proactiveEnabled || !canRunAI || !ready) {
      if (scheduleRef.current) { clearInterval(scheduleRef.current); scheduleRef.current = null; }
      return;
    }

    const scheduleTick = async () => {
      if (AppState.currentState !== 'active') return;
      const trigger = detectScheduledTrigger();
      if (!trigger) return;

      if (trigger === 'morning' || trigger === 'evening') markFired(trigger);
      if (trigger === 'checkin') kv.set('proactive_last_checkin', dayjs().toISOString());

      // Build extra detail for proactive triggers
      let detail: string | undefined;
      const state = useStore.getState();

      if (trigger === 'morning') {
        // Include mood prompt in morning briefing
        const todayMood = state.moodLogs.find(l =>
          l.logged_at.startsWith(dayjs().format('YYYY-MM-DD'))
        );
        if (!todayMood) {
          detail = 'User has not logged mood/energy today. Ask how they are feeling and offer to log it.';
        }
      }

      if (trigger === 'evening') {
        // Include inbox triage prompt in evening reflection
        const untriagedCount = state.inboxItems.filter(i => !i.triaged).length;
        if (untriagedCount > 0) {
          detail = `User has ${untriagedCount} untriaged inbox item${untriagedCount > 1 ? 's' : ''}. Offer to triage them.`;
        }
      }

      const labels: Record<string, string> = {
        morning: 'Morning Briefing',
        checkin: 'Check-in',
        evening: 'Evening Reflection',
      };
      await fireProactive(trigger, labels[trigger], detail);
    };

    scheduleTick();
    scheduleRef.current = setInterval(scheduleTick, SCHEDULE_INTERVAL_MS);
    return () => { if (scheduleRef.current) { clearInterval(scheduleRef.current); scheduleRef.current = null; } };
  }, [proactiveEnabled, canRunAI, ready]);

  // Event-driven triggers (calendar/email) — 2 min interval
  useEffect(() => {
    if (!proactiveEnabled || !canRunAI || !ready || !isGoogleConnected) {
      if (eventRef.current) { clearInterval(eventRef.current); eventRef.current = null; }
      return;
    }

    const eventTick = async () => {
      if (AppState.currentState !== 'active') return;

      // Sync Google data if stale before checking
      const state = useStore.getState();
      const now = Date.now();
      const STALE_MS = 2 * 60_000; // 2 min stale threshold for event detection
      if (state.calendarLastSynced && now - new Date(state.calendarLastSynced).getTime() > STALE_MS) {
        try { await state.syncCalendarEvents(); } catch { /* ignore */ }
      }
      if (state.emailLastSynced && now - new Date(state.emailLastSynced).getTime() > STALE_MS) {
        try { await state.syncEmails(); } catch { /* ignore */ }
      }

      const trigger = detectEventTriggers();
      if (!trigger) return;

      await fireProactive(trigger.type, trigger.label, trigger.detail);
    };

    // First tick after 10s (let scheduled triggers go first)
    const initTimeout = setTimeout(eventTick, 10_000);
    eventRef.current = setInterval(eventTick, EVENT_INTERVAL_MS);
    return () => {
      clearTimeout(initTimeout);
      if (eventRef.current) { clearInterval(eventRef.current); eventRef.current = null; }
    };
  }, [proactiveEnabled, canRunAI, ready, isGoogleConnected]);
}

/**
 * Call this when the user manually sends a command in the AI screen.
 * Prevents check-in from firing within 1 hour of user activity.
 */
export function markUserAiInteraction(): void {
  kv.set('last_user_ai_interaction', dayjs().toISOString());
}
