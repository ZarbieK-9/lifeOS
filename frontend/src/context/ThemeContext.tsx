import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { kv } from '@/src/db/mmkv';
import { AdaptiveZen } from '@/src/theme/DesignSystem';

type ThemeMode = 'light' | 'dark' | 'system';
type AdaptivePalette = (typeof AdaptiveZen)[keyof typeof AdaptiveZen];

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  palette: AdaptivePalette;
};

const THEME_MODE_KEY = 'adaptive_zen_mode_v1';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeContextProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>((kv.getString(THEME_MODE_KEY) as ThemeMode) || 'system');

  const resolvedMode: 'light' | 'dark' = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const palette = resolvedMode === 'dark' ? AdaptiveZen.dark : AdaptiveZen.light;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      resolvedMode,
      palette,
      setMode: (nextMode) => {
        setModeState(nextMode);
        kv.set(THEME_MODE_KEY, nextMode);
      },
    }),
    [mode, resolvedMode, palette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useThemeContext must be used within ThemeContextProvider');
  }
  return ctx;
}

