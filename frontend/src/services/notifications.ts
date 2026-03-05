// Notification permissions + channel setup for proactive AI

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { kv } from '../db/mmkv';

/**
 * Request notification permissions and set up Android channels.
 * Stores result in MMKV so we don't re-prompt every launch.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    kv.set('notification_permission', true);
    await setupAndroidChannels();
    await setupNotificationCategories();
    return true;
  }

  const result = await Notifications.requestPermissionsAsync();
  const granted = result.granted;
  kv.set('notification_permission', granted);

  if (granted) {
    await setupAndroidChannels();
    await setupNotificationCategories();
  }
  return granted;
}

export function hasNotificationPermission(): boolean {
  return kv.getBool('notification_permission') ?? false;
}

/**
 * Set up notification action categories (iOS + Android).
 * "proactive_reply" category has Copy Reply + Open App buttons.
 */
export async function setupNotificationCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync('proactive_reply', [
    {
      identifier: 'copy_reply',
      buttonTitle: 'Copy Reply',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'open_app',
      buttonTitle: 'Open App',
      options: { opensAppToForeground: true },
    },
  ]);

  await Notifications.setNotificationCategoryAsync('proactive_basic', [
    {
      identifier: 'open_app',
      buttonTitle: 'Open App',
      options: { opensAppToForeground: true },
    },
  ]);
}

async function setupAndroidChannels() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('proactive', {
    name: 'PicoClaw AI',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'Morning briefings, check-ins, and evening reflections',
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    description: 'Scheduled reminders',
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync('app_notifications', {
    name: 'App Notifications',
    importance: Notifications.AndroidImportance.DEFAULT,
    description: 'AI reactions to notifications from other apps',
    sound: 'default',
  });
}

/**
 * Send a local notification for a proactive AI message.
 * @param channelId - Android channel: 'app_notifications' for notification_alert (other apps), 'proactive' for scheduled
 * @param options.suggestedReply - Optional; stored in data for notification actions (e.g. Copy reply) when supported
 */
export async function sendProactiveNotification(
  title: string,
  body: string,
  channelId: 'proactive' | 'app_notifications' = 'proactive',
  options?: { suggestedReply?: string }
): Promise<void> {
  if (!hasNotificationPermission()) return;

  const hasSuggestedReply = options?.suggestedReply != null && options.suggestedReply.trim() !== '';

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: body.length > 200 ? body.slice(0, 197) + '...' : body,
      data: {
        type: 'proactive',
        ...(hasSuggestedReply ? { suggestedReply: options!.suggestedReply } : {}),
      },
      categoryIdentifier: hasSuggestedReply ? 'proactive_reply' : 'proactive_basic',
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: null, // immediate
  });
}
