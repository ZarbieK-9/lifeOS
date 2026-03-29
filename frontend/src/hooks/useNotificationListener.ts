// useNotificationListener — Listens to notifications from other apps (Android only)
// Uses expo-android-notification-listener-service to read device notifications
// Filters out own notifications, silent/ongoing, group summaries, duplicates
// Rate limits per source app (2-min cooldown) and fires proactive AI
// Supports user-configurable app whitelist

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { kv } from '../db/mmkv';
import { useStore } from '../store/useStore';
import { checkNotificationAccess, refreshNotificationAccess } from '../services/notificationAccess';

const isExpoGo = Constants.appOwnership === 'expo';

const APP_COOLDOWN_MS = 2 * 60_000; // 2 min per source app
const DEDUP_WINDOW_MS = 30_000; // 30s — ignore same notification key

// MMKV-backed per-app cooldown
function getLastAlertTime(packageName: string): number {
  const ts = kv.getString(`notif_cooldown_${packageName}`);
  return ts ? new Date(ts).getTime() : 0;
}

function setLastAlertTime(packageName: string): void {
  kv.set(`notif_cooldown_${packageName}`, new Date().toISOString());
}

// In-memory dedup (resets on app restart, which is fine)
const recentKeys = new Map<string, number>();

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const prev = recentKeys.get(key);
  if (prev && now - prev < DEDUP_WINDOW_MS) return true;
  recentKeys.set(key, now);
  // Prune old entries
  if (recentKeys.size > 100) {
    for (const [k, t] of recentKeys) {
      if (now - t > DEDUP_WINDOW_MS) recentKeys.delete(k);
    }
  }
  return false;
}

// Packages to always ignore
const IGNORED_PACKAGES = new Set([
  'com.android.systemui',
  'android',
  'com.android.providers.downloads',
]);

// Our own package — filled lazily
let ownPackage: string = '';

function getOwnPackage(): string {
  if (ownPackage) return ownPackage;
  try {
    const expoApp = require('expo-application') as typeof import('expo-application');
    ownPackage = expoApp.applicationId ?? 'com.lifeos.app';
  } catch {
    ownPackage = 'com.lifeos.app';
  }
  return ownPackage;
}

// ── Seen packages tracking ──

function getSeenPackages(): Array<{ packageName: string; appName: string }> {
  const raw = kv.getString('seen_notif_packages');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

function trackSeenPackage(packageName: string, appName: string): void {
  const seen = getSeenPackages();
  if (seen.some(s => s.packageName === packageName)) return;
  const updated = [...seen, { packageName, appName: appName || packageName }];
  kv.set('seen_notif_packages', JSON.stringify(updated));
  // Update store so Settings UI reflects new apps
  useStore.getState().loadSeenPackages();
}

// ── Whitelist ──

function getAllowedPackages(): string[] {
  const raw = kv.getString('allowed_notif_packages');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Should we react to this notification?
 */
function shouldProcess(notif: {
  packageName: string;
  title: string;
  text: string;
  key: string;
  summaryText: string;
}): boolean {
  // Skip own notifications
  if (notif.packageName === getOwnPackage()) return false;

  // Skip system packages
  if (IGNORED_PACKAGES.has(notif.packageName)) return false;

  // Skip empty notifications (silent / ongoing)
  if (!notif.title && !notif.text) return false;

  // Skip group summary notifications (usually "N messages" style)
  if (notif.summaryText && !notif.text) return false;

  // Check whitelist — if non-empty, only allow listed packages
  const allowed = getAllowedPackages();
  if (allowed.length > 0 && !allowed.includes(notif.packageName)) return false;

  // Dedup within 30s
  if (isDuplicate(notif.key)) return false;

  // Per-app rate limit
  const now = Date.now();
  if (now - getLastAlertTime(notif.packageName) < APP_COOLDOWN_MS) return false;

  return true;
}

/**
 * Hook that subscribes to device notifications and fires proactive AI.
 * Always active on Android when permission is granted. Auto-prompts for permission on first launch.
 */
export function useNotificationListener() {
  const subRef = useRef<{ remove: () => void } | null>(null);

  const notifListenerEnabled = useStore(s => s.notificationListenerEnabled);
  const ready = useStore(s => s.ready);

  // ── Reactive permission state ──
  // Live-check on mount and whenever the app returns to foreground
  // (e.g. user just toggled permission in Android Settings).
  const [accessGranted, setAccessGranted] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || isExpoGo) return;

    const check = (autoPrompt = false) => {
      const granted = refreshNotificationAccess(); // live native check + sync MMKV cache
      setAccessGranted(granted);
      if (__DEV__) console.log('[NotifListener] Permission check:', granted);
      // Auto-prompt once on first launch if not granted
      if (!granted && autoPrompt) {
        const { requestNotificationAccess } = require('../services/notificationAccess');
        requestNotificationAccess();
      }
    };

    check(true); // initial check + auto-prompt on mount

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check(); // re-check when returning from Android Settings
    });

    return () => sub.remove();
  }, []);

  // ── Subscription effect ──
  useEffect(() => {
    // Guard: Android only, not Expo Go, listener enabled, store ready, permission granted
    if (
      Platform.OS !== 'android' ||
      isExpoGo ||
      !notifListenerEnabled ||
      !ready ||
      !accessGranted
    ) {
      if (__DEV__) {
        console.log('[NotifListener] Guard failed:', {
          android: Platform.OS === 'android',
          notExpoGo: !isExpoGo,
          notifListenerEnabled,
          ready,
          accessGranted,
        });
      }
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
      return;
    }

    let mod: any;
    try {
      mod = require('expo-android-notification-listener-service').default;
    } catch {
      console.warn('[NotifListener] Module not available (use a dev build for notification listening)');
      return;
    }

    if (!mod || typeof mod.addListener !== 'function') {
      console.warn('[NotifListener] Module loaded but addListener not available — check expo-android-notification-listener-service version');
      return;
    }

    // Apply whitelist to native module if configured
    const allowed = getAllowedPackages();
    if (allowed.length > 0) {
      try { mod.setAllowedPackages(allowed); } catch { /* ignore */ }
    }

    if (__DEV__) console.log('[NotifListener] Subscribing to onNotificationReceived');

    const subscription = mod.addListener('onNotificationReceived', (notif: {
      packageName: string;
      id: number;
      title: string;
      text: string;
      bigText: string;
      subText: string;
      summaryText: string;
      postTime: number;
      key: string;
      appName: string;
      appIconPath: string;
    }) => {
      if (__DEV__) console.log('[NotifListener] Received:', notif.appName || notif.packageName, notif.title);

      // Track this app in seen packages (before filtering)
      trackSeenPackage(notif.packageName, notif.appName);

      if (!shouldProcess(notif)) {
        if (__DEV__) console.log('[NotifListener] Filtered out:', notif.packageName);
        return;
      }

      // Mark cooldown for this app
      setLastAlertTime(notif.packageName);

      // Build detail string for the AI
      const body = notif.bigText || notif.text;
      const detail = [
        `App: ${notif.appName || notif.packageName}`,
        notif.title ? `Title: "${notif.title}"` : null,
        body ? `Message: "${body}"` : null,
      ].filter(Boolean).join('. ');

      const label = notif.appName
        ? `${notif.appName}: ${notif.title || 'Notification'}`
        : notif.title || 'App Notification';

      // Fire proactive AI asynchronously
      fireNotificationAlert(detail, label).catch(e =>
        console.warn('[NotifListener] Failed to fire proactive:', e)
      );
    });

    subRef.current = subscription;

    return () => {
      if (__DEV__) console.log('[NotifListener] Unsubscribing');
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
    };
  }, [notifListenerEnabled, ready, accessGranted]);
}

async function fireNotificationAlert(detail: string, label: string): Promise<void> {
  const { runProactive, cleanOutput, generateSuggestedReply } = await import('../agent/agent');
  const { extractSuggestedReply } = await import('../utils/suggestedReply');
  const store = useStore.getState();
  const cmdId = await store.addAiCommand(`[${label}]`, 'notification_alert');

  const response = await runProactive({ type: 'notification_alert', cmdId, detail });
  const cleaned = cleanOutput(response.output);
  await store.resolveAiCommand(cmdId, cleaned, 'executed');

  let suggestedReply = extractSuggestedReply(cleaned);
  if (!suggestedReply && detail) {
    suggestedReply = await generateSuggestedReply(detail) ?? undefined;
  }
  const { sendProactiveNotification } = await import('../services/notifications');
  await sendProactiveNotification(label, cleaned, 'app_notifications', suggestedReply ? { suggestedReply } : undefined);
}
