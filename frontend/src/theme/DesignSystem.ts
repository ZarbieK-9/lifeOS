export const Palette = {
  background: '#F9FBF9',
  card: '#FFFFFF',
  textMain: '#2D3436',
  textMuted: '#636E72',

  primary: '#86A789',
  secondary: '#FFCFB3',
  accent: '#A1EEBD',
  error: '#FF7675',

  radius: 28,
  spacing: 16,
};

export const Shadows = {
  soft: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
};

export const AdaptiveZen = {
  light: {
    background: '#FFFDFB',
    backgroundAlt: '#F9FBF9',
    card: '#FFFFFF',
    border: '#E9ECEF',
    text: '#2D3436',
    textMuted: '#636E72',
    primary: '#86A789',
    secondary: '#FFCFB3',
    accent: '#A1EEBD',
    danger: '#FF7675',
  },
  dark: {
    background: '#0F172A',
    backgroundAlt: '#121212',
    card: '#1E293B',
    border: '#334155',
    text: '#E5E7EB',
    textMuted: '#AAB2C0',
    primary: '#88B196',
    secondary: '#E9B09A',
    accent: '#A1EEBD',
    danger: '#FDA4AF',
  },
} as const;

