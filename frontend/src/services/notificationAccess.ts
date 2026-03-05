// Notification Access permission — Android only
// Wraps expo-android-notification-listener-service for permission checks
// Native module is not available in Expo Go; use a development build for real behavior.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { kv } from '../db/mmkv';

const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Check if Notification Access is granted (Android only).
 * Returns false on iOS or in Expo Go (native module unavailable).
 */
export function checkNotificationAccess(): boolean {
  if (Platform.OS !== 'android') return false;
  if (isExpoGo) return false;
  try {
    const module = require('expo-android-notification-listener-service').default;
    return module.isNotificationPermissionGranted();
  } catch {
    return false;
  }
}

/**
 * Open Android Settings → Notification Access page.
 * No-op on iOS or in Expo Go.
 */
export function requestNotificationAccess(): void {
  if (Platform.OS !== 'android') return;
  if (isExpoGo) return;
  try {
    const module = require('expo-android-notification-listener-service').default;
    module.openNotificationListenerSettings();
  } catch (e) {
    console.warn('[NotificationAccess] Failed to open settings:', e);
  }
}

/**
 * Quick cached check (for guards that run frequently).
 */
export function hasNotificationAccess(): boolean {
  return kv.getBool('notification_access_granted') ?? false;
}

/**
 * Refresh the cached permission state. Call after returning from Settings.
 */
export function refreshNotificationAccess(): boolean {
  const granted = checkNotificationAccess();
  kv.set('notification_access_granted', granted);
  return granted;
}
