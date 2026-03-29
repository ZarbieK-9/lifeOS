// Scheduled local nudges from Me → Day profile (wake, commute, work, bedtime).
// Complements background task "late for office" checks.

import dayjs from "dayjs";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import { hasNotificationPermission } from "./notifications";
import { useStore } from "../store/useStore";
import { parseHHmm, addMinutesToClock } from "../utils/dayProfileTime";

const isExpoGo = Constants.appOwnership === "expo";

export const DAY_PROFILE_IDS = {
  wake: "lifeos_day_wake",
  leaveSoon: "lifeos_day_leave_soon",
  work: "lifeos_day_work",
  bedtime: "lifeos_day_bedtime",
} as const;

export async function cancelDayProfileNotifications(): Promise<void> {
  if (isExpoGo) return;
  for (const id of Object.values(DAY_PROFILE_IDS)) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      /* ignore */
    }
  }
}

export async function registerDayProfileNotifications(): Promise<void> {
  await cancelDayProfileNotifications();
  if (isExpoGo) return;
  if (!hasNotificationPermission()) return;

  const p = useStore.getState().userProfile;
  if (!p || p.day_coach_enabled === 0) return;

  const androidContent = Platform.OS === "android" ? { channelId: "proactive" as const } : {};
  const androidTrigger = Platform.OS === "android" ? { channelId: "proactive" as const } : {};

  const wake = parseHHmm(p.typical_wake_time);
  if (wake) {
    await Notifications.scheduleNotificationAsync({
      identifier: DAY_PROFILE_IDS.wake,
      content: {
        title: "Good morning",
        body: "Your day profile — check priorities and hydrate early.",
        data: { type: "day_profile", kind: "wake" },
        categoryIdentifier: "proactive_basic",
        ...androidContent,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: wake.hour,
        minute: wake.minute,
        ...androidTrigger,
      },
    });
  }

  const leave = parseHHmm(p.leave_home_time);
  if (leave) {
    const warn = addMinutesToClock(leave.hour, leave.minute, -15);
    await Notifications.scheduleNotificationAsync({
      identifier: DAY_PROFILE_IDS.leaveSoon,
      content: {
        title: "Heading out soon?",
        body: `You planned to leave around ${p.leave_home_time}. Buffer a minute for shoes and keys.`,
        data: { type: "day_profile", kind: "leave_soon" },
        categoryIdentifier: "proactive_basic",
        ...androidContent,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: warn.hour,
        minute: warn.minute,
        ...androidTrigger,
      },
    });
  }

  const work = parseHHmm(p.work_start_time);
  if (work) {
    await Notifications.scheduleNotificationAsync({
      identifier: DAY_PROFILE_IDS.work,
      content: {
        title: "Work time",
        body: `You aim to be on deck by ${p.work_start_time}. If you’re cutting it close, send a quick heads-up.`,
        data: { type: "day_profile", kind: "work" },
        categoryIdentifier: "proactive_basic",
        ...androidContent,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: work.hour,
        minute: work.minute,
        ...androidTrigger,
      },
    });
  }

  const bed = parseHHmm(p.typical_bedtime);
  if (bed) {
    await Notifications.scheduleNotificationAsync({
      identifier: DAY_PROFILE_IDS.bedtime,
      content: {
        title: "Wind-down",
        body: `Target bedtime around ${p.typical_bedtime} — dim screens and set one tiny win for tomorrow.`,
        data: { type: "day_profile", kind: "bedtime" },
        categoryIdentifier: "proactive_basic",
        ...androidContent,
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DAILY,
        hour: bed.hour,
        minute: bed.minute,
        ...androidTrigger,
      },
    });
  }
}

/** One-time playful nudge when the user may be late for their own leave-home time (background). */
export async function runDayProfileLateNudge(): Promise<boolean> {
  const { kv } = await import("../db/mmkv");
  const { sendProactiveNotification } = await import("./notifications");

  const p = useStore.getState().userProfile;
  if (!p || p.day_coach_enabled === 0) return false;

  const leave = parseHHmm(p.leave_home_time);
  if (!leave) return false;

  const now = dayjs();
  const today = now.format("YYYY-MM-DD");
  const leaveToday = now.hour(leave.hour).minute(leave.minute).second(0).millisecond(0);
  const afterLeave = now.isAfter(leaveToday) && now.isBefore(leaveToday.add(50, "minute"));
  const hour = now.hour();
  if (hour < 5 || hour > 12) return false;
  if (!afterLeave) return false;

  const key = `day_profile_late_nudge_${today}`;
  if (kv.getString(key)) return false;

  const lines = [
    `Still home? You aimed to leave around ${p.leave_home_time}.`,
    "No stress — text someone if you’re late, then grab water and go.",
    "Traffic happens; you’ve got this.",
  ];
  const body = lines[Math.floor(Math.random() * lines.length)];

  await sendProactiveNotification("Morning check-in", body);
  kv.set(key, "1");
  return true;
}
