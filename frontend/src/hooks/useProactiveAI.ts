// useProactiveAI — Thin wrapper that delegates to the unified watcher system.
// All proactive scheduling, event detection, and notification logic now lives in watcher.ts.
// This hook only handles React lifecycle (start/stop intervals) and Google sync polling.

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { kv } from '../db/mmkv';
import { useStore } from '../store/useStore';
import dayjs from 'dayjs';

const SYNC_INTERVAL_MS = 120_000; // 2 min — poll Google sync

export function useProactiveAI() {
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const proactiveEnabled = useStore(s => s.proactiveAIEnabled);
  const ready = useStore(s => s.ready);
  const isGoogleConnected = useStore(s => s.isGoogleConnected);
  const isMicrosoftConnected = useStore(s => s.isMicrosoftConnected);
  const isBackendConfigured = useStore(s => s.isBackendConfigured);

  // Server coach notifications + canonical commitments pull
  useEffect(() => {
    if (!ready || !isBackendConfigured) {
      return;
    }
    const tick = () => {
      if (AppState.currentState !== 'active') return;
      useStore.getState().syncServerCoachState().catch(() => {});
    };
    const t0 = setTimeout(tick, 8_000);
    const id = setInterval(tick, 120_000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearTimeout(t0);
      clearInterval(id);
      sub.remove();
    };
  }, [ready, isBackendConfigured]);

  // Google / Microsoft calendar + Gmail sync polling — keep data fresh for watcher + coach
  useEffect(() => {
    if (!proactiveEnabled || !ready || (!isGoogleConnected && !isMicrosoftConnected)) {
      if (syncRef.current) { clearInterval(syncRef.current); syncRef.current = null; }
      return;
    }

    const syncTick = async () => {
      if (AppState.currentState !== 'active') return;
      const state = useStore.getState();
      const now = Date.now();
      const STALE_MS = 2 * 60_000;
      const calStale =
        !state.calendarLastSynced ||
        now - new Date(state.calendarLastSynced).getTime() > STALE_MS;

      if (state.isGoogleConnected && calStale) {
        try { await state.syncCalendarEvents(); } catch { /* ignore */ }
      }
      if (state.isMicrosoftConnected && calStale) {
        try { await state.syncMicrosoftCalendarEvents(); } catch { /* ignore */ }
      }
      if (
        state.isGoogleConnected &&
        state.emailLastSynced &&
        now - new Date(state.emailLastSynced).getTime() > STALE_MS
      ) {
        try { await state.syncEmails(); } catch { /* ignore */ }
      }
    };

    const initTimeout = setTimeout(syncTick, 10_000);
    syncRef.current = setInterval(syncTick, SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(initTimeout);
      if (syncRef.current) { clearInterval(syncRef.current); syncRef.current = null; }
    };
  }, [proactiveEnabled, ready, isGoogleConnected, isMicrosoftConnected]);
}

/**
 * Call this when the user manually sends a command in the AI screen.
 * Prevents check-in from firing within 1 hour of user activity.
 */
export function markUserAiInteraction(): void {
  kv.set('last_user_ai_interaction', dayjs().toISOString());
}
