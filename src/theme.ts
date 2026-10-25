import { MD3DarkTheme } from 'react-native-paper';

export const palette = {
  background: '#121016',
  surface: '#1c1921',
  raised: '#26212d',
  high: '#332c3d',
  primary: '#d0bcff',
  onPrimary: '#381e72',
  accent: '#ffcc80',
  onAccent: '#442b00',
  text: '#ece6f0',
  muted: '#cac4d0',
  outline: '#938a9f',
  error: '#ffb4ab',
  success: '#b5dbb1',
  audio: '#b5dbd3',
  onAudio: '#163c36',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 16, lg: 24, xl: 28 };

export const theme = {
  ...MD3DarkTheme,
  roundness: 4,
  colors: {
    ...MD3DarkTheme.colors,
    primary: palette.primary,
    onPrimary: palette.onPrimary,
    primaryContainer: palette.high,
    onPrimaryContainer: palette.primary,
    secondary: palette.accent,
    onSecondary: palette.onAccent,
    secondaryContainer: palette.raised,
    onSecondaryContainer: palette.text,
    background: palette.background,
    onBackground: palette.text,
    surface: palette.surface,
    onSurface: palette.text,
    surfaceVariant: palette.raised,
    onSurfaceVariant: palette.muted,
    outline: palette.outline,
    outlineVariant: palette.high,
    error: palette.error,
    elevation: {
      level0: 'transparent',
      level1: palette.surface,
      level2: palette.raised,
      level3: palette.raised,
      level4: palette.high,
      level5: palette.high,
    },
  },
};
