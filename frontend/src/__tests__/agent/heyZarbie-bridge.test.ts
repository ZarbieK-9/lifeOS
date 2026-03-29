import { NativeModules } from "react-native";
import {
  getHeyZarbieWakeState,
  registerHeyZarbieListeners,
  syncHeyZarbieState,
} from "@/src/services/heyZarbie";

jest.mock("react-native", () => {
  const listeners: Record<string, Array<(payload: any) => void>> = {};
  class MockEmitter {
    addListener(event: string, cb: (payload: any) => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
      return {
        remove: () => {
          listeners[event] = (listeners[event] ?? []).filter((x) => x !== cb);
        },
      };
    }
  }
  return {
    Platform: { OS: "android" },
    NativeModules: {
      HeyZarbieModule: {
        startWakeListener: jest.fn().mockResolvedValue(true),
        stopWakeListener: jest.fn().mockResolvedValue(true),
        getWakeState: jest.fn().mockResolvedValue("listening"),
        openAssistant: jest.fn().mockResolvedValue(true),
        consumePendingVoiceCommand: jest.fn().mockResolvedValue(""),
      },
    },
    NativeEventEmitter: MockEmitter,
    __listeners: listeners,
  };
});

describe("heyZarbie bridge", () => {
  it("starts listener when enabled", async () => {
    await syncHeyZarbieState({
      enabled: true,
      onlyWhenCharging: false,
      pauseOnLowBattery: true,
      sensitivity: "balanced",
      launchBehavior: "popup",
    });
    expect((NativeModules as any).HeyZarbieModule.startWakeListener).toHaveBeenCalled();
  });

  it("returns wake state from native", async () => {
    await expect(getHeyZarbieWakeState()).resolves.toBe("listening");
  });

  it("registers transcript listener", () => {
    const onTranscript = jest.fn();
    const unsub = registerHeyZarbieListeners({ onTranscript });
    expect(typeof unsub).toBe("function");
  });
});
