// Single source for theme. Prefer `theme` (unified AppTheme) for new UI.

import { useColorScheme } from 'react-native';
import { AppTheme, CALM, Colors, Radii, ScreenColors, Spacing, Typography } from '@/constants/theme';

export function useAppTheme() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const palette = isDark ? AppTheme.dark : AppTheme.light;
  return {
    isDark,
    /** Unified palette — use for all new screens and components. */
    theme: {
      ...palette,
      typography: Typography,
      spacing: Spacing,
      radii: Radii,
    },
    /** @deprecated Use theme instead. Kept for compatibility. */
    colors: isDark ? Colors.dark : Colors.light,
    /** @deprecated Use theme instead. Maps to theme. */
    screen: { bg: palette.surface, surface: palette.background, border: palette.border, text: palette.text, sub: palette.textSecondary, primary: palette.primary, primaryBg: palette.primaryBg, success: palette.success, successBg: palette.successBg, warn: palette.warn, warnBg: palette.warnBg, danger: palette.danger, dangerBg: palette.dangerBg, codeBg: palette.surfaceElevated } as const,
    /** @deprecated Use theme for chat; calm kept for AiScreen compatibility. */
    calm: isDark ? CALM.dark : CALM.light,
  };
}
