import React from "react";
import { Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { ScreenContainer, ScreenHeader, Section } from "@/src/components/layout";
import { Card } from "@/src/components/Card";
import { useAppTheme } from "@/src/hooks/useAppTheme";
import { useStore } from "@/src/store/useStore";
import { useHaptics } from "@/src/hooks/useHaptics";
import { isHeyZarbieNativeAvailable, openHeyZarbieAssistant } from "@/src/services/heyZarbie";

export default function HeyZarbieSettingsScreen() {
  const { theme } = useAppTheme();
  const haptic = useHaptics();
  const enabled = useStore((s) => s.heyZarbieEnabled);
  const onlyWhenCharging = useStore((s) => s.heyZarbieOnlyWhenCharging);
  const pauseOnLowBattery = useStore((s) => s.heyZarbiePauseOnLowBattery);
  const sensitivity = useStore((s) => s.heyZarbieSensitivity);
  const launchBehavior = useStore((s) => s.heyZarbieLaunchBehavior);
  const consent = useStore((s) => s.heyZarbieConsentGranted);
  const setConfig = useStore((s) => s.setHeyZarbieConfig);
  const setConsent = useStore((s) => s.setHeyZarbieConsent);

  const nativeOk = isHeyZarbieNativeAvailable();
  const canEnable = Platform.OS === "android" && consent && nativeOk;

  return (
    <ScreenContainer scroll header={<ScreenHeader title="Hey Zarbie" />}>
      {!nativeOk && Platform.OS === "android" && (
        <Section title="Setup">
          <Card variant="outlined">
            <Text style={[ss.warn, { color: theme.warn }]}>
              Native wake module not linked. Use a dev build (`expo run:android`), not Expo Go, and run prebuild so
              `withHeyZarbieAndroid` generates Android code.
            </Text>
          </Card>
        </Section>
      )}
      <Section
        title="Hands-free assistant"
        description="Android dev build only. Leave the ongoing notification visible in the tray—swiping the app away can stop listening; never force-stop. Turn on consent, then Enable. Wake uses Vosk (free, Apache-2.0): download an English model from alphacephei.com/vosk/models, put the unpacked folder contents at frontend/assets/model-en-us/ (must include uuid), then prebuild / expo run:android."
      >
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>I consent to always-listening wake phrase</Text>
            <Switch
              value={consent}
              onValueChange={(v) => {
                haptic.light();
                setConsent(v);
                if (!v) setConfig({ enabled: false });
              }}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Required before enabling background mic listening.
          </Text>

          <View style={[ss.row, ss.topBorder, { borderColor: theme.border }]}>
            <Text style={[ss.label, { color: theme.text }]}>Enable Hey Zarbie</Text>
            <Switch
              value={enabled}
              disabled={!canEnable}
              onValueChange={(v) => {
                haptic.light();
                setConfig({ enabled: v });
              }}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          {!canEnable && (
            <Text style={[ss.hint, { color: theme.textSecondary }]}>
              {nativeOk
                ? "Android + consent required before activation."
                : "Fix native module + bundle frontend/assets/model-en-us (Vosk English model, then prebuild), then consent + enable."}
            </Text>
          )}
        </Card>
      </Section>

      <Section title="Battery and behavior">
        <Card variant="outlined">
          <View style={ss.row}>
            <Text style={[ss.label, { color: theme.text }]}>Only when charging</Text>
            <Switch
              value={onlyWhenCharging}
              onValueChange={(v) => {
                haptic.light();
                setConfig({ onlyWhenCharging: v });
              }}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          <View style={[ss.row, ss.topBorder, { borderColor: theme.border }]}>
            <Text style={[ss.label, { color: theme.text }]}>Pause on low battery</Text>
            <Switch
              value={pauseOnLowBattery}
              onValueChange={(v) => {
                haptic.light();
                setConfig({ pauseOnLowBattery: v });
              }}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
          <Text style={[ss.hint, { color: theme.textSecondary }]}>
            Protects battery while keeping wake response fast.
          </Text>
        </Card>
      </Section>

      <Section title="Sensitivity">
        <Card variant="outlined">
          <View style={ss.chipRow}>
            {(["low", "balanced", "high"] as const).map((value) => (
              <TouchableOpacity
                key={value}
                style={[
                  ss.chip,
                  { backgroundColor: sensitivity === value ? theme.primary : theme.border },
                ]}
                onPress={() => {
                  haptic.light();
                  setConfig({ sensitivity: value });
                }}
              >
                <Text style={{ color: sensitivity === value ? "#fff" : theme.text }}>
                  {value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
      </Section>

      <Section
        title="Launch style"
        description="After you speak, the app opens the AI tab so you see the reply. (The native mic sheet is separate.)"
      >
        <Card variant="outlined">
          <View style={ss.chipRow}>
            {([
              { id: "popup", label: "Quiet handoff" },
              { id: "open_ai_tab", label: "Open AI tab" },
            ] as const).map((mode) => (
              <TouchableOpacity
                key={mode.id}
                style={[
                  ss.chip,
                  { backgroundColor: launchBehavior === mode.id ? theme.primary : theme.border },
                ]}
                onPress={() => {
                  haptic.light();
                  setConfig({ launchBehavior: mode.id });
                }}
              >
                <Text style={{ color: launchBehavior === mode.id ? "#fff" : theme.text }}>
                  {mode.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[ss.testBtn, { backgroundColor: theme.primary }]}
            onPress={() => {
              haptic.light();
              openHeyZarbieAssistant().catch(() => {});
            }}
          >
            <Text style={ss.testBtnText}>Test popup now</Text>
          </TouchableOpacity>
        </Card>
      </Section>
    </ScreenContainer>
  );
}

const ss = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 15, fontWeight: "500", flex: 1 },
  hint: { fontSize: 12, marginTop: 8 },
  warn: { fontSize: 13, lineHeight: 20 },
  topBorder: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  testBtn: { marginTop: 14, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
  testBtnText: { color: "#fff", fontWeight: "700" },
});
