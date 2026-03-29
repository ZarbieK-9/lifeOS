/**
 * iOS-style theme — system colors, typography, and spacing.
 * Aligns with Apple HIG for a native iOS feel.
 */

import { Platform } from 'react-native';

// ── iOS system colors (light / dark) ─────────────────────────────────────
export const iOSColors = {
  light: {
    // Backgrounds
    systemBackground: '#FFFFFF',
    secondarySystemBackground: '#F2F2F7',
    tertiarySystemBackground: '#FFFFFF',
    groupedBackground: '#F2F2F7',
    // Fill (cards, inputs)
    systemFill: '#E5E5EA',
    secondarySystemFill: '#EBEBF0',
    tertiarySystemFill: '#F2F2F7',
    // Labels
    label: '#000000',
    secondaryLabel: '#3C3C43',
    tertiaryLabel: '#3C3C4399',
    quaternaryLabel: '#3C3C434D',
    // Separator
    separator: '#3C3C4349',
    opaqueSeparator: '#C6C6C8',
    // Tint / accent
    systemBlue: '#007AFF',
    systemGreen: '#34C759',
    systemRed: '#FF3B30',
    systemOrange: '#FF9500',
    systemPurple: '#AF52DE',
    systemTeal: '#5AC8FA',
    systemIndigo: '#5856D6',
    // Semantic
    link: '#007AFF',
    systemGray: '#8E8E93',
    systemGray2: '#AEAEB2',
    systemGray3: '#C7C7CC',
    systemGray4: '#D1D1D6',
    systemGray5: '#E5E5EA',
    systemGray6: '#F2F2F7',
  },
  dark: {
    systemBackground: '#000000',
    secondarySystemBackground: '#1C1C1E',
    tertiarySystemBackground: '#2C2C2E',
    groupedBackground: '#000000',
    systemFill: '#38383A',
    secondarySystemFill: '#48484A',
    tertiarySystemFill: '#48484A',
    label: '#FFFFFF',
    secondaryLabel: '#EBEBF5',
    tertiaryLabel: '#EBEBF599',
    quaternaryLabel: '#EBEBF54D',
    separator: '#54545899',
    opaqueSeparator: '#38383A',
    systemBlue: '#0A84FF',
    systemGreen: '#30D158',
    systemRed: '#FF453A',
    systemOrange: '#FF9F0A',
    systemPurple: '#BF5AF2',
    systemTeal: '#64D2FF',
    systemIndigo: '#5E5CE6',
    link: '#0A84FF',
    systemGray: '#8E8E93',
    systemGray2: '#636366',
    systemGray3: '#48484A',
    systemGray4: '#3A3A3C',
    systemGray5: '#2C2C2E',
    systemGray6: '#1C1C1E',
  },
} as const;

// ── App semantic mapping (for screens that need named tokens) ─────────────
const tintColorLight = iOSColors.light.systemBlue;
const tintColorDark = iOSColors.dark.systemBlue;

export const Colors = {
  light: {
    text: iOSColors.light.label,
    background: iOSColors.light.systemBackground,
    tint: tintColorLight,
    icon: iOSColors.light.systemGray,
    tabIconDefault: iOSColors.light.systemGray,
    tabIconSelected: tintColorLight,
    ...iOSColors.light,
  },
  dark: {
    text: iOSColors.dark.label,
    background: iOSColors.dark.systemBackground,
    tint: tintColorDark,
    icon: iOSColors.dark.systemGray,
    tabIconDefault: iOSColors.dark.systemGray,
    tabIconSelected: tintColorDark,
    ...iOSColors.dark,
  },
};

// ── Typography (with line heights for consistency) ─────────────────────────
export const Typography = {
  display: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41 },
  title1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  title2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  title3: { fontSize: 20, fontWeight: '600' as const, lineHeight: 25 },
  headline: { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 17, fontWeight: '400' as const, lineHeight: 24 },
  callout: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  subhead: { fontSize: 15, fontWeight: '400' as const, lineHeight: 20 },
  footnote: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption1: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  caption2: { fontSize: 11, fontWeight: '400' as const, lineHeight: 14 },
};

// ── Spacing & layout ────────────────────────────────────────────────────
export const Spacing = {
  screenPadding: 20,
  screenPaddingWide: 24,
  sectionSpacing: 24,
  sectionGap: 24,
  itemSpacing: 12,
  groupCornerRadius: 10,
  cardCornerRadius: 14,
  cardPadding: 16,
  buttonCornerRadius: 12,
  smallCornerRadius: 8,
  chipRadius: 20,
  tabBarHeight: 49,
};

// ── Radii (use for cards, modals, buttons) ─────────────────────────────────
export const Radii = {
  card: 14,
  cardMedium: 16,
  cardLarge: 20,
  button: 12,
  chip: 20,
  input: 12,
  small: 8,
};

// ── Shadow tokens for elevated cards (light/dark) ─────────────────────────
export const Shadow = {
  light: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  dark: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', system-ui, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
});

// ── Screen palette (shared by Settings, Tasks, Partner, lists, cards, buttons) ─
export const ScreenColors = {
  light: {
    bg: '#ffffff',
    surface: '#f5f7fa',
    border: '#e2e8f0',
    text: '#11181c',
    sub: '#687076',
    primary: '#0a7ea4',
    primaryBg: '#e0f2fe',
    success: '#10b981',
    successBg: '#d1fae5',
    warn: '#f59e0b',
    warnBg: '#fef3c7',
    danger: '#ef4444',
    dangerBg: '#fee2e2',
    codeBg: '#f1f5f9',
  },
  dark: {
    bg: '#151718',
    surface: '#1e2022',
    border: '#2d3338',
    text: '#ecedee',
    sub: '#9ba1a6',
    primary: '#38bdf8',
    primaryBg: '#0c4a6e',
    success: '#34d399',
    successBg: '#064e3b',
    warn: '#fbbf24',
    warnBg: '#78350f',
    danger: '#f87171',
    dangerBg: '#7f1d1d',
    codeBg: '#2d3338',
  },
} as const;

// ── Calming chat palette (muted teal + soft coral) for AI screen ─────────────
export const CALM = {
  light: {
    gradient: ['#e0ebe8', '#e8e8e2', '#f0ebe6'] as const,
    teal: '#5a8f86',
    tealSoft: '#8fb8b0',
    tealBg: '#d4e5e2',
    coral: '#c99b8f',
    coralSoft: '#e8d4ce',
    sage: '#7a9b8f',
    text: '#3d4a47',
    textSecondary: '#6b7c78',
    inputBg: '#e2eae8',
    inputBorder: '#c5d4d0',
    sendInactive: '#a8bdb8',
    error: '#a67c73',
  },
  dark: {
    gradient: ['#1a2f2c', '#1e2826', '#242a28'] as const,
    teal: '#6ba89e',
    tealSoft: '#5a8a82',
    tealBg: '#2d403c',
    coral: '#b88a7f',
    coralSoft: '#4a3f3c',
    sage: '#6b8f84',
    text: '#d8e2df',
    textSecondary: '#9aaba6',
    inputBg: '#2a3634',
    inputBorder: '#3d4f4b',
    sendInactive: '#4a5c58',
    error: '#9a7269',
  },
} as const;

// ── Unified AppTheme (single source of truth for all screens) ───────────────
export type AppThemePalette = {
  background: string;
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  backgroundGradient: readonly [string, string, string];
  cardGradient: readonly [string, string];
  border: string;
  divider: string;
  text: string;
  textSecondary: string;
  primary: string;
  primaryBg: string;
  success: string;
  successBg: string;
  warn: string;
  warnBg: string;
  danger: string;
  dangerBg: string;
  inputBg: string;
  inputBorder: string;
  tabBarBg: string;
  tabActive: string;
  tabInactive: string;
};

export const AppTheme = {
  light: {
    background: '#f5f3ef',
    surface: '#fcfaf6',
    surfaceElevated: '#f4efe8',
    surfaceMuted: '#efe7dd',
    backgroundGradient: ['#f6f3ee', '#f3f0ea', '#ece7df'],
    cardGradient: ['#ffffff', '#f7f2eb'],
    border: '#ded4c8',
    divider: '#e5dbcf',
    text: '#201d18',
    textSecondary: '#6d645b',
    primary: '#5e8f88',
    primaryBg: '#dce8e5',
    success: '#10b981',
    successBg: '#d1fae5',
    warn: '#f59e0b',
    warnBg: '#fef3c7',
    danger: '#ef4444',
    dangerBg: '#fee2e2',
    inputBg: '#f0ebe4',
    inputBorder: '#cbbfb2',
    tabBarBg: '#f7f2ea',
    tabActive: '#4e7f78',
    tabInactive: '#8f8478',
  } satisfies AppThemePalette,
  dark: {
    background: '#101213',
    surface: '#181b1d',
    surfaceElevated: '#21272b',
    surfaceMuted: '#2b3339',
    backgroundGradient: ['#0f1316', '#141a1e', '#1a2025'],
    cardGradient: ['#20262b', '#171c20'],
    border: '#2e3941',
    divider: '#243038',
    text: '#edf1f3',
    textSecondary: '#a0adb5',
    primary: '#78afa7',
    primaryBg: '#1f3a37',
    success: '#34d399',
    successBg: '#064e3b',
    warn: '#fbbf24',
    warnBg: '#78350f',
    danger: '#f87171',
    dangerBg: '#7f1d1d',
    inputBg: '#1d2327',
    inputBorder: '#35434c',
    tabBarBg: '#13181c',
    tabActive: '#86bcb4',
    tabInactive: '#8ea0a8',
  } satisfies AppThemePalette,
} as const;
