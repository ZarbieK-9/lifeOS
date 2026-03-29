import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type WakeState = "idle" | "listening" | "cooldown";

export type HeyZarbieConfig = {
  enabled: boolean;
  onlyWhenCharging: boolean;
  pauseOnLowBattery: boolean;
  sensitivity: "low" | "balanced" | "high";
  launchBehavior: "popup" | "open_ai_tab";
};

type TranscriptPayload = {
  text: string;
  source?: string;
};

type WakeEventPayload = {
  state?: WakeState;
  reason?: string;
};

type HeyZarbieEvents = {
  onTranscript?: (payload: TranscriptPayload) => void;
  onWakeDetected?: (payload: WakeEventPayload) => void;
  onWakeError?: (payload: WakeEventPayload) => void;
};

const moduleRef = (NativeModules as Record<string, any>).HeyZarbieModule;

/** True when the native Hey Zarbie module is linked (Android dev build with the config plugin — not Expo Go). */
export function isHeyZarbieNativeAvailable(): boolean {
  return Platform.OS === "android" && !!moduleRef;
}

function isAvailable() {
  return isHeyZarbieNativeAvailable();
}

export async function syncHeyZarbieState(config: HeyZarbieConfig): Promise<void> {
  if (!isAvailable()) return;
  if (!config.enabled) {
    await moduleRef.stopWakeListener();
    return;
  }
  await moduleRef.startWakeListener(config);
}

export async function openHeyZarbieAssistant(): Promise<void> {
  if (!isAvailable()) return;
  await moduleRef.openAssistant();
}

export async function getHeyZarbieWakeState(): Promise<WakeState> {
  if (!isAvailable()) return "idle";
  const state = await moduleRef.getWakeState();
  if (state === "listening" || state === "cooldown") return state;
  return "idle";
}

/**
 * Text saved when HeyZarbie speech finished while React was not ready (app backgrounded).
 * Clears storage when read. Call on AppState "active" so voice commands are not lost.
 */
export async function consumePendingHeyZarbieCommand(): Promise<string | null> {
  if (!isAvailable()) return null;
  const fn = moduleRef.consumePendingVoiceCommand as
    | (() => Promise<string>)
    | undefined;
  if (typeof fn !== "function") return null;
  try {
    const text = await fn();
    const t = typeof text === "string" ? text.trim() : "";
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export function registerHeyZarbieListeners(events: HeyZarbieEvents): () => void {
  if (!isAvailable()) return () => {};
  const emitter = new NativeEventEmitter(moduleRef);
  const subs = [
    events.onTranscript
      ? emitter.addListener("onTranscript", events.onTranscript)
      : null,
    events.onWakeDetected
      ? emitter.addListener("onWakeDetected", events.onWakeDetected)
      : null,
    events.onWakeError
      ? emitter.addListener("onWakeError", events.onWakeError)
      : null,
  ].filter(Boolean) as { remove: () => void }[];
  return () => {
    for (const sub of subs) sub.remove();
  };
}
