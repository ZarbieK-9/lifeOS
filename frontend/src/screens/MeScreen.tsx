// Me profile — weight, height, goals, BMR/TDEE, hydration suggestion, meal plan (PicoClaw)

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import dayjs from "dayjs";
import { useStore } from "../store/useStore";
import { useAppTheme } from "../hooks/useAppTheme";
import { Card } from "@/src/components/Card";
import { ScreenContainer, Section, RowCard } from "@/src/components/layout";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { PressableScale } from "@/components/PressableScale";
import { Typography, Spacing, Radii } from "@/constants/theme";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import {
  computeBMR,
  computeTDEE,
  computeTargetCalories,
  computeWaterMl,
  ageFromBirthDate,
  bmi,
  type ActivityLevel,
} from "../utils/meProfileCalculations";
import { run } from "../agent/agent";
import { kv } from "@/src/db/mmkv";
import { buildOneDayMealPlanPrompt } from "@/src/prompts/mealPlanPrompts";

const ACTIVITY_LEVELS: ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
];
const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Light",
  moderate: "Moderate",
  active: "Active",
  very_active: "Very active",
};
const GENDERS = ["male", "female", "other"] as const;
const GOAL_TYPES = ["lose", "maintain", "gain"] as const;

export default function MeScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const userProfile = useStore((s) => s.userProfile);
  const setUserProfile = useStore((s) => s.setUserProfile);
  const saveUserProfile = useStore((s) => s.saveUserProfile);
  const loadUserProfile = useStore((s) => s.loadUserProfile);
  const hydrationStartHour = useStore((s) => s.hydrationStartHour);
  const hydrationEndHour = useStore((s) => s.hydrationEndHour);
  const hydrationIntervalMin = useStore((s) => s.hydrationIntervalMin);
  const setHydrationReminder = useStore((s) => s.setHydrationReminder);
  const weightLogs = useStore((s) => s.weightLogs);

  const [mealPlanLoading, setMealPlanLoading] = useState(false);
  const [mealPlanText, setMealPlanText] = useState<string | null>(null);
  const [showMealPlan, setShowMealPlan] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);

  useEffect(() => {
    loadUserProfile();
  }, [loadUserProfile]);

  const p = userProfile;
  const weight = p?.weight_kg ?? null;
  const height = p?.height_cm ?? null;
  const birthDate = p?.birth_date ?? null;
  const gender = (p?.gender as "male" | "female" | "other") ?? "male";
  const activityLevel = (p?.activity_level as ActivityLevel) ?? "moderate";
  const targetWeight = p?.target_weight_kg ?? null;
  const targetDate = p?.target_date ?? null;
  const goalType = (p?.goal_type as "gain" | "lose" | "maintain") ?? "maintain";

  const age = ageFromBirthDate(birthDate);
  const bmr =
    weight != null && height != null && weight > 0 && height > 0
      ? computeBMR(weight, height, age, gender)
      : 0;
  const tdee = bmr > 0 ? computeTDEE(bmr, activityLevel) : 0;
  const targetCalories =
    weight != null &&
    targetWeight != null &&
    weight > 0 &&
    tdee > 0
      ? computeTargetCalories(
          tdee,
          goalType,
          weight,
          targetWeight,
          targetDate,
        )
      : tdee > 0 ? Math.round(tdee) : 0;
  const waterMl = weight != null && weight > 0 ? computeWaterMl(weight) : 2500;
  const waterL = (waterMl / 1000).toFixed(1);
  const currentBmi =
    weight != null && height != null && weight > 0 && height > 0
      ? bmi(weight, height)
      : 0;
  const targetBmi =
    targetWeight != null && height != null && targetWeight > 0 && height > 0
      ? bmi(targetWeight, height)
      : 0;
  const goalProgress =
    weight != null && targetWeight != null
      ? Math.max(0, Math.min(100, Math.round((1 - Math.abs(targetWeight - weight) / Math.max(weight, targetWeight, 1)) * 100)))
      : 0;
  const latestWeight = weightLogs[0];

  const onSave = useCallback(async () => {
    await saveUserProfile();
  }, [saveUserProfile]);

  const onApplyHydration = useCallback(() => {
    setHydrationReminder(
      hydrationStartHour ?? 7,
      hydrationEndHour ?? 22,
      waterMl,
      hydrationIntervalMin ?? 84,
    );
  }, [
    setHydrationReminder,
    hydrationStartHour,
    hydrationEndHour,
    waterMl,
    hydrationIntervalMin,
  ]);

  const onGetMealPlan = useCallback(async () => {
    if (!p || weight == null || height == null) {
      setMealPlanText("Please fill in weight and height first.");
      setShowMealPlan(true);
      return;
    }
    setMealPlanLoading(true);
    setMealPlanText(null);
    try {
      const prompt = buildOneDayMealPlanPrompt({
        weightKg: weight,
        heightCm: height,
        goalType,
        targetWeightKg: targetWeight,
        targetDate,
        targetCalories,
      });
      const result = await run(prompt, [], {});
      setMealPlanText(result?.output?.trim() ?? "No response.");
      setShowMealPlan(true);
    } catch (e) {
      setMealPlanText(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setShowMealPlan(true);
    } finally {
      setMealPlanLoading(false);
    }
  }, [
    p,
    weight,
    height,
    goalType,
    targetWeight,
    targetDate,
    targetCalories,
  ]);

  return (
    <>
      <ScreenContainer scroll keyboardAvoiding keyboardVerticalOffset={8}>
        <LinearGradient
          colors={[theme.surface, theme.surfaceMuted] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={ss.hero}
        >
          <Text style={[ss.title, { color: theme.text }]}>Me & Settings</Text>
          <Text style={[ss.subtitle, { color: theme.textSecondary }]}>
            Profile, goals, and daily targets
          </Text>
        </LinearGradient>

        <RowCard
          title="Day profile"
          subtitle="Normal day, activities, commute times — coach & nudges use this"
          onPress={() => router.push("/me/day-profile")}
          right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
          variant="elevated"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ss.healthCards}>
          <Card variant="elevated" style={ss.healthCard}>
            <Text style={[ss.healthLabel, { color: theme.textSecondary }]}>Metrics</Text>
            <SoftRing progress={Math.min(100, Math.round((currentBmi / 35) * 100))} color={theme.primary} />
            <Text style={[ss.healthValue, { color: theme.text }]}>{currentBmi > 0 ? `BMI ${currentBmi}` : 'Add profile'}</Text>
          </Card>
          <Card variant="elevated" style={ss.healthCard}>
            <Text style={[ss.healthLabel, { color: theme.textSecondary }]}>Goals</Text>
            <SoftRing progress={goalProgress} color={theme.warn} />
            <Text style={[ss.healthValue, { color: theme.text }]}>{goalProgress > 0 ? `${goalProgress}% aligned` : 'Set target'}</Text>
          </Card>
          <Card variant="elevated" style={ss.healthCard}>
            <Text style={[ss.healthLabel, { color: theme.textSecondary }]}>History</Text>
            <SoftRing progress={latestWeight ? 100 : 0} color={theme.success} />
            <Text style={[ss.healthValue, { color: theme.text }]}>
              {latestWeight ? `${latestWeight.weight_kg} kg · ${dayjs(latestWeight.date).format('MMM D')}` : 'No logs yet'}
            </Text>
          </Card>
        </ScrollView>

        <Section title="Profile">
        <Card variant="elevated" style={ss.card}>
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Weight (kg)
            </Text>
            <TextInput
              style={[
                ss.input,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="e.g. 70"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={weight != null ? String(weight) : ""}
              onChangeText={(t) =>
                setUserProfile({
                  weight_kg: t === "" ? null : parseFloat(t) || null,
                })
              }
            />
          </View>
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Height (cm)
            </Text>
            <TextInput
              style={[
                ss.input,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="e.g. 175"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={height != null ? String(height) : ""}
              onChangeText={(t) =>
                setUserProfile({
                  height_cm: t === "" ? null : parseFloat(t) || null,
                })
              }
            />
          </View>
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Birth date (optional)
            </Text>
            <TextInput
              style={[
                ss.input,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              value={birthDate ?? ""}
              onChangeText={(t) =>
                setUserProfile({ birth_date: t.trim() || null })
              }
            />
          </View>
          <Text style={[ss.label, { color: theme.textSecondary, marginTop: 8 }]}>
            Gender
          </Text>
          <View style={ss.chipRow}>
            {GENDERS.map((g) => (
              <PressableScale
                key={g}
                style={[
                  ss.chip,
                  {
                    backgroundColor:
                      gender === g ? theme.primaryBg : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setUserProfile({ gender: g })}
              >
                <Text
                  style={[
                    ss.chipText,
                    { color: gender === g ? theme.primary : theme.text },
                  ]}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </Text>
              </PressableScale>
            ))}
          </View>
          <Text style={[ss.label, { color: theme.textSecondary, marginTop: 8 }]}>
            Activity level
          </Text>
          <View style={ss.chipRow}>
            {ACTIVITY_LEVELS.map((a) => (
              <PressableScale
                key={a}
                style={[
                  ss.chipSmall,
                  {
                    backgroundColor:
                      activityLevel === a ? theme.primaryBg : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setUserProfile({ activity_level: a })}
              >
                <Text
                  style={[
                    ss.chipTextSmall,
                    { color: activityLevel === a ? theme.primary : theme.text },
                  ]}
                  numberOfLines={1}
                >
                  {ACTIVITY_LABELS[a]}
                </Text>
              </PressableScale>
            ))}
          </View>
        </Card>
        </Section>

        <Section title="Goal">
        <Card variant="elevated" style={ss.card}>
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Target weight (kg)
            </Text>
            <TextInput
              style={[
                ss.input,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="e.g. 80"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              value={targetWeight != null ? String(targetWeight) : ""}
              onChangeText={(t) =>
                setUserProfile({
                  target_weight_kg: t === "" ? null : parseFloat(t) || null,
                })
              }
            />
          </View>
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.textSecondary }]}>
              Target date
            </Text>
            <TextInput
              style={[
                ss.input,
                { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
              ]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textSecondary}
              value={targetDate ?? ""}
              onChangeText={(t) =>
                setUserProfile({ target_date: t.trim() || null })
              }
            />
          </View>
          <Text style={[ss.label, { color: theme.textSecondary }]}>
            Goal type
          </Text>
          <View style={ss.chipRow}>
            {GOAL_TYPES.map((g) => (
              <PressableScale
                key={g}
                style={[
                  ss.chip,
                  {
                    backgroundColor:
                      goalType === g ? theme.primaryBg : theme.surface,
                    borderColor: theme.border,
                  },
                ]}
                onPress={() => setUserProfile({ goal_type: g })}
              >
                <Text
                  style={[
                    ss.chipText,
                    { color: goalType === g ? theme.primary : theme.text },
                  ]}
                >
                  {g.charAt(0).toUpperCase() + g.slice(1)}
                </Text>
              </PressableScale>
            ))}
          </View>
        </Card>
        </Section>

        <Section title="Recommended daily">
        <Card variant="elevated" style={ss.card}>
          {currentBmi > 0 && (
            <Text style={[ss.meta, { color: theme.textSecondary }]}>
              BMI: {currentBmi}
              {targetBmi > 0 ? ` → target ${targetBmi}` : ""}
            </Text>
          )}
          {targetCalories > 0 && (
            <Text style={[ss.big, { color: theme.primary }]}>
              {targetCalories} kcal
            </Text>
          )}
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Water: {waterL} L ({waterMl} ml)
          </Text>
          <PressableScale
            style={[ss.button, { backgroundColor: theme.primaryBg }]}
            onPress={onApplyHydration}
          >
            <Text style={[ss.buttonText, { color: theme.primary }]}>
              Apply to hydration goal
            </Text>
          </PressableScale>
        </Card>
        </Section>

        <RowCard
          title="Weight history"
          subtitle="View weight log and trends"
          onPress={() => router.push("/me/weight")}
          right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
          variant="outlined"
        />

        <Section title="Meal plan">
        <Card variant="elevated" style={ss.card}>
          <Text style={[ss.meta, { color: theme.textSecondary }]}>
            Concrete meals, calories per meal, daily macros, optional supplements — hydration at most one line.
          </Text>
          <PressableScale
            style={[
              ss.button,
              { backgroundColor: theme.primary },
              mealPlanLoading && ss.buttonDisabled,
            ]}
            onPress={onGetMealPlan}
            disabled={mealPlanLoading}
          >
            {mealPlanLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[ss.buttonText, { color: "#fff" }]}>
                Get meal plan
              </Text>
            )}
          </PressableScale>
        </Card>
        </Section>

        <Section title="Settings Hub">
          <RowCard
            title="All settings"
            subtitle="Full list: account, integrations, AI, Hey Zarbie, about"
            onPress={() => router.push("/settings")}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="elevated"
          />
          <RowCard
            title="Hey Zarbie"
            subtitle="Android wake phrase, consent, mic popup"
            onPress={() => router.push("/settings/hey-zarbie")}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="outlined"
          />
          <RowCard
            title="Account & connection"
            subtitle="Backend URL, login, sync"
            onPress={() => router.push("/settings/account")}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="outlined"
          />
          <RowCard
            title="Google & Microsoft"
            subtitle="Calendar, email, and Outlook integrations"
            onPress={() => router.push("/settings/google")}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="outlined"
          />
          <RowCard
            title="AI personalization"
            subtitle="Proactive AI, quiet hours, notifications hub"
            onPress={() => router.push("/settings/notifications")}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="outlined"
          />
          <RowCard
            title="Help journey"
            subtitle="Replay first-time guide"
            onPress={() => {
              kv.delete("onboarding_journey_done");
              router.push("/(auth)/journey");
            }}
            right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
            variant="outlined"
          />
          <TouchableOpacity
            style={[ss.devToggle, { borderColor: theme.border, backgroundColor: theme.surface }]}
            onPress={() => setShowDevTools((v) => !v)}
          >
            <Text style={[ss.devTitle, { color: theme.text }]}>Developer tools</Text>
            <Text style={[ss.devHint, { color: theme.textSecondary }]}>{showDevTools ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
          {showDevTools && (
            <>
              <RowCard
                title="Latency diagnostics"
                subtitle="p50/p95 route, plan, validate, tool, post-process"
                onPress={() => router.push("/settings/latency-diagnostics")}
                right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
                variant="outlined"
              />
              <RowCard
                title="API keys"
                subtitle="Tasker, IFTTT, webhooks"
                onPress={() => router.push("/settings/api-keys")}
                right={<IconSymbol name="chevron.right" size={20} color={theme.textSecondary} />}
                variant="outlined"
              />
            </>
          )}
        </Section>

        <PressableScale
          style={[ss.saveButton, { backgroundColor: theme.primary }]}
          onPress={onSave}
        >
          <Text style={ss.saveButtonText}>Save profile</Text>
        </PressableScale>

        <View style={{ height: 40 }} />
      </ScreenContainer>

      {/* Meal plan modal */}
      <Modal
        visible={showMealPlan}
        animationType="slide"
        transparent
        onRequestClose={() => setShowMealPlan(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={ss.modalBg}
        >
          <View style={[ss.modal, { backgroundColor: theme.background }]}>
            <View style={ss.modalHeader}>
              <Text style={[ss.modalTitle, { color: theme.text }]}>
                Meal plan
              </Text>
              <TouchableOpacity onPress={() => setShowMealPlan(false)}>
                <Text style={[ss.modalClose, { color: theme.primary }]}>
                  Close
                </Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={ss.modalBody}>
              <Text
                style={[ss.modalBodyText, { color: theme.text }]}
                selectable
              >
                {mealPlanText ?? "Loading…"}
              </Text>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const ss = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { padding: Spacing.screenPadding, paddingBottom: 40 },
  hero: {
    padding: 16,
    borderRadius: Radii.cardLarge,
    marginBottom: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { ...Typography.largeTitle, marginBottom: 4, letterSpacing: 0.2 },
  subtitle: { ...Typography.subhead },
  healthCards: { gap: 12, paddingBottom: 16 },
  healthCard: { width: 170, borderRadius: 24, alignItems: "center", gap: 8, paddingVertical: 14 },
  healthLabel: { fontSize: 12, fontWeight: "600" },
  healthValue: { fontSize: 13, fontWeight: "600", textAlign: "center", lineHeight: 18 },
  card: { marginBottom: 16, gap: 10 },
  cardTitle: { ...Typography.headline },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  label: { fontSize: 14, flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: Radii.input,
    padding: 12,
    fontSize: 16,
    minWidth: 100,
    flex: 1,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radii.chip,
    borderWidth: 1,
  },
  chipSmall: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.small,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: "600" },
  chipTextSmall: { fontSize: 12, fontWeight: "600" },
  meta: { fontSize: 13 },
  big: { fontSize: 24, fontWeight: "700" },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: Radii.button,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { fontSize: 16, fontWeight: "600" },
  saveButton: {
    paddingVertical: 16,
    borderRadius: Radii.button,
    alignItems: "center",
    marginTop: 8,
  },
  saveButtonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  modalBg: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000066",
  },
  modal: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  modalClose: { fontSize: 16, fontWeight: "600" },
  modalBody: { maxHeight: 400 },
  modalBodyText: { fontSize: 15, lineHeight: 22 },
  devToggle: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 4,
  },
  devTitle: { fontSize: 15, fontWeight: "600" },
  devHint: { fontSize: 13, fontWeight: "500" },
});

function SoftRing({ progress, color }: { progress: number; color: string }) {
  const size = 68;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={size} height={size}>
      <SvgCircle cx={size / 2} cy={size / 2} r={r} stroke="#E8EEE8" strokeWidth={stroke} fill="none" />
      <SvgCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${c}`}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(100, progress)) / 100)}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
