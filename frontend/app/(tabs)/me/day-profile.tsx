import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Switch,
} from "react-native";
import { useStore } from "@/src/store/useStore";
import { ScreenContainer, Section, ScreenHeader } from "@/src/components/layout";
import { Card } from "@/src/components/Card";
import { useAppTheme } from "@/src/hooks/useAppTheme";
import { PressableScale } from "@/components/PressableScale";
import { Radii } from "@/constants/theme";
import { computeWaterMl } from "@/src/utils/meProfileCalculations";
import { normalizeHHmm } from "@/src/utils/dayProfileTime";

export default function DayProfileScreen() {
  const { theme } = useAppTheme();
  const userProfile = useStore((s) => s.userProfile);
  const setUserProfile = useStore((s) => s.setUserProfile);
  const saveUserProfile = useStore((s) => s.saveUserProfile);
  const loadUserProfile = useStore((s) => s.loadUserProfile);
  const hydrationStartHour = useStore((s) => s.hydrationStartHour);
  const hydrationEndHour = useStore((s) => s.hydrationEndHour);
  const hydrationIntervalMin = useStore((s) => s.hydrationIntervalMin);
  const setHydrationReminder = useStore((s) => s.setHydrationReminder);

  const [savedHint, setSavedHint] = useState<string | null>(null);

  useEffect(() => {
    loadUserProfile();
  }, [loadUserProfile]);

  const p = userProfile;
  const weight = p?.weight_kg ?? null;
  const waterMl =
    weight != null && weight > 0 ? computeWaterMl(weight) : 2500;

  const onSave = useCallback(async () => {
    setSavedHint(null);
    await saveUserProfile();
    setSavedHint("Saved. Coach and notifications will use this.");
  }, [saveUserProfile]);

  const onApplyHydration = useCallback(() => {
    setHydrationReminder(
      hydrationStartHour ?? 7,
      hydrationEndHour ?? 22,
      waterMl,
      hydrationIntervalMin ?? 90,
    );
    setSavedHint(`Hydration goal set to ${waterMl} ml (from your weight).`);
  }, [
    setHydrationReminder,
    hydrationStartHour,
    hydrationEndHour,
    waterMl,
    hydrationIntervalMin,
  ]);

  const setTime = (key: "typical_wake_time" | "leave_home_time" | "work_start_time" | "typical_bedtime", text: string) => {
    const t = text.trim();
    if (t === "") {
      setUserProfile({ [key]: null });
      return;
    }
    const n = normalizeHHmm(t);
    setUserProfile({ [key]: n ?? t });
  };

  return (
    <ScreenContainer
      scroll
      header={<ScreenHeader title="Day profile" />}
    >
      <Section
        title="Your normal day"
        description="Used by the morning coach, AI context, and gentle nudges. Weight and calories stay on the main Me screen."
      >
        <Card variant="elevated" style={ss.card}>
          <Text style={[ss.label, { color: theme.textSecondary }]}>
            What does a typical weekday look like?
          </Text>
          <TextInput
            style={[ss.area, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            placeholder="e.g. Wake 6:30, kids to school, deep work 9–12, gym at 6…"
            placeholderTextColor={theme.textSecondary}
            multiline
            value={p?.day_outline ?? ""}
            onChangeText={(t) => setUserProfile({ day_outline: t || null })}
          />
        </Card>

        <Card variant="elevated" style={ss.card}>
          <Text style={[ss.label, { color: theme.textSecondary }]}>
            Activities you want to protect
          </Text>
          <TextInput
            style={[ss.area, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
            placeholder="Walk, reading, gym, calling family…"
            placeholderTextColor={theme.textSecondary}
            multiline
            value={p?.activity_prefs ?? ""}
            onChangeText={(t) => setUserProfile({ activity_prefs: t || null })}
          />
        </Card>
      </Section>

      <Section
        title="Times (24h, e.g. 07:30)"
        description="Optional. Sets scheduled reminders and helps the coach flag calendar clashes."
      >
        <Card variant="outlined" style={ss.card}>
          {(
            [
              ["typical_wake_time", "Wake up", p?.typical_wake_time] as const,
              ["leave_home_time", "Leave home / commute", p?.leave_home_time] as const,
              ["work_start_time", "Be at work / first commitment", p?.work_start_time] as const,
              ["typical_bedtime", "Target bedtime", p?.typical_bedtime] as const,
            ] as const
          ).map(([key, label, val]) => (
            <View key={key} style={ss.row}>
              <Text style={[ss.rowLabel, { color: theme.textSecondary }]}>{label}</Text>
              <TextInput
                style={[ss.timeInput, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                placeholder="—"
                placeholderTextColor={theme.textSecondary}
                value={val ?? ""}
                onChangeText={(t) => setTime(key, t)}
                autoCapitalize="none"
              />
            </View>
          ))}
        </Card>
      </Section>

      <Section title="Goals & hydration">
        <Card variant="outlined" style={ss.card}>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Weight targets: edit on Me main screen. Apply recommended water from your current weight:
          </Text>
          <Text style={[ss.meta, { color: theme.text }]}>
            Suggested {waterMl} ml/day
            {weight == null ? " (add weight on Me first)" : ""}
          </Text>
          <PressableScale
            style={[ss.btn, { backgroundColor: theme.primaryBg }]}
            onPress={onApplyHydration}
          >
            <Text style={[ss.btnText, { color: theme.primary }]}>Apply hydration goal</Text>
          </PressableScale>
        </Card>
      </Section>

      <Section title="Coach & nudges">
        <Card variant="outlined" style={ss.card}>
          <View style={ss.switchRow}>
            <Text style={[ss.switchLabel, { color: theme.text }]}>
              Use this profile for coach + reminders
            </Text>
            <Switch
              value={p?.day_coach_enabled !== 0}
              onValueChange={(v) => setUserProfile({ day_coach_enabled: v ? 1 : 0 })}
              trackColor={{ false: theme.border, true: theme.primaryBg }}
              thumbColor={p?.day_coach_enabled !== 0 ? theme.primary : theme.surface}
            />
          </View>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            When on: morning plan includes your outline, scheduled local reminders (wake, leave, work, bedtime), and a
            playful check-in if you’re past your leave-home time. Respects notification permission.
          </Text>
        </Card>
      </Section>

      {savedHint ? (
        <Text style={[ss.hint, { color: theme.success }]}>{savedHint}</Text>
      ) : null}

      <PressableScale style={[ss.save, { backgroundColor: theme.primary }]} onPress={onSave}>
        <Text style={ss.saveText}>Save day profile</Text>
      </PressableScale>

      <View style={{ height: 40 }} />
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  card: { marginBottom: 12, gap: 10 },
  label: { fontSize: 14, fontWeight: "600" },
  area: {
    borderWidth: 1,
    borderRadius: Radii.input,
    padding: 12,
    minHeight: 100,
    fontSize: 16,
    textAlignVertical: "top",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  rowLabel: { fontSize: 12, flex: 1 },
  timeInput: {
    borderWidth: 1,
    borderRadius: Radii.input,
    padding: 10,
    width: 88,
    fontSize: 16,
    textAlign: "center",
  },
  meta: { fontSize: 13, lineHeight: 20 },
  btn: {
    paddingVertical: 12,
    borderRadius: Radii.button,
    alignItems: "center",
    marginTop: 8,
  },
  btnText: { fontSize: 16, fontWeight: "600" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  switchLabel: { fontSize: 15, lineHeight: 22, flex: 1 },
  hint: { fontSize: 14, marginBottom: 8, paddingHorizontal: 4 },
  save: {
    paddingVertical: 16,
    borderRadius: Radii.button,
    alignItems: "center",
    marginTop: 8,
  },
  saveText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
