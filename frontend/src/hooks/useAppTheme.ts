// Single source for theme. Prefer `theme` (unified AppTheme) for new UI.

import { useColorScheme } from 'react-native';
import { AppTheme, CALM, Colors, Radii, Shadow, Spacing, Typography } from '@/constants/theme';
import { Shadows } from '@/src/theme/DesignSystem';
import { useThemeContext } from '@/src/context/ThemeContext';

export function useAppTheme() {
  const colorScheme = useColorScheme();
  const { resolvedMode, palette: adaptivePalette } = useThemeContext();
  const isDark = resolvedMode === 'dark' || colorScheme === 'dark';
  const palette = isDark
    ? {
        ...AppTheme.dark,
        background: adaptivePalette.background,
        surface: adaptivePalette.card,
        surfaceElevated: adaptivePalette.card,
        surfaceMuted: adaptivePalette.backgroundAlt,
        backgroundGradient: [adaptivePalette.background, adaptivePalette.backgroundAlt, '#0B1220'] as const,
        cardGradient: [adaptivePalette.card, '#223042'] as const,
        border: adaptivePalette.border,
        divider: adaptivePalette.border,
        text: adaptivePalette.text,
        textSecondary: adaptivePalette.textMuted,
        primary: adaptivePalette.primary,
        primaryBg: '#1B2A39',
        success: adaptivePalette.accent,
        successBg: '#1C2E2F',
        warn: adaptivePalette.secondary,
        warnBg: '#332C2A',
        danger: adaptivePalette.danger,
        dangerBg: '#3A1F28',
        inputBg: '#1A2636',
        inputBorder: adaptivePalette.border,
        tabBarBg: '#162130CC',
        tabActive: adaptivePalette.accent,
        tabInactive: adaptivePalette.textMuted,
      }
    : {
        ...AppTheme.light,
        background: adaptivePalette.background,
        surface: adaptivePalette.card,
        surfaceElevated: adaptivePalette.card,
        surfaceMuted: '#FFFDFB',
        backgroundGradient: [adaptivePalette.background, '#FFFDFB', '#FAFAFA'] as const,
        cardGradient: [adaptivePalette.card, '#FFFEFD'] as const,
        border: adaptivePalette.border,
        divider: '#EEF2EE',
        text: adaptivePalette.text,
        textSecondary: adaptivePalette.textMuted,
        primary: adaptivePalette.primary,
        primaryBg: '#EDF4ED',
        success: adaptivePalette.accent,
        successBg: '#E9F9EF',
        warn: adaptivePalette.secondary,
        warnBg: '#FFF3EA',
        danger: adaptivePalette.danger,
        dangerBg: '#FFEAEA',
        inputBg: '#FFFFFF',
        inputBorder: '#E4EBE4',
        tabBarBg: '#FFFFFFEE',
        tabActive: adaptivePalette.primary,
        tabInactive: adaptivePalette.textMuted,
      };
  return {
    isDark,
    /** Unified palette — use for all new screens and components. */
    theme: {
      ...palette,
      typography: Typography,
      spacing: Spacing,
      radii: { ...Radii, card: 28, cardLarge: 28, button: 28, input: 20 },
      shadow: isDark ? Shadow.dark : Shadows.soft,
    },
    /** @deprecated Use theme instead. Kept for compatibility. */
    colors: isDark ? Colors.dark : Colors.light,
    /** @deprecated Use theme instead. Maps to theme. */
    screen: { bg: palette.surface, surface: palette.background, border: palette.border, text: palette.text, sub: palette.textSecondary, primary: palette.primary, primaryBg: palette.primaryBg, success: palette.success, successBg: palette.successBg, warn: palette.warn, warnBg: palette.warnBg, danger: palette.danger, dangerBg: palette.dangerBg, codeBg: palette.surfaceElevated } as const,
    /** @deprecated Use theme for chat; calm kept for AiScreen compatibility. */
    calm: isDark ? CALM.dark : CALM.light,
  };
}
