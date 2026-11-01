import type { TextStyle } from 'react-native';

/** Light theme tokens (contract 01). Components never hard-code colours. */
export const colors = {
  backdrop: '#E7E3DA',
  bg: '#F5F2EB',
  surface: '#FFFDF9',
  ink: '#1C1B18',
  muted: '#6E695E',
  faint: '#A39E92',
  line: '#E3DED3',
  accent: '#2F5D50',
  accentSoft: '#DCE8E2',
  onAccent: '#FFFFFF',
  /** Action text on ink surfaces (toast Undo). */
  onInkAction: '#BFD8CD',
  /** Secondary text on ink surfaces. */
  onInkMuted: '#D9D5CC',
  scrim: 'rgba(28, 27, 24, 0.32)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;
/** Minimum touch target in dp/pt (contract 01). */
export const touch = 48;

export const type = {
  title: { fontSize: 32, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  body: { fontSize: 17, fontWeight: '600', color: colors.ink },
  detail: { fontSize: 14, fontWeight: '400', color: colors.muted },
  number: { fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;
