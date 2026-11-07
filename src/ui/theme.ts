import { useContext, useMemo } from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { ThemeContext, type ThemeChoice } from './ThemeContext';

/** Typed theme registry (contract 01). Rendering code reads contextual tokens. */
const classicColors = {
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
  /** A raised control on ink surfaces (the Full/Short switch track). */
  inkRaised: '#3A3833',
  /** Secondary text on ink surfaces. */
  onInkMuted: '#D9D5CC',
  /** A second data series in charts (#52): distinct from ink and accent in hue and lightness. */
  warm: '#B4561F',
  scrim: 'rgba(28, 27, 24, 0.32)',
  card: '#1C1B18',
  onCard: '#FFFFFF',
  onCardMuted: '#D9D5CC',
  priority: '#FFBD72',
  activated: '#78C9DF',
  sore: '#F0C46A',
  injured: '#FF9C9C',
  primary: '#1C1B18',
} as const;
export type ThemeId = 'classic' | 'hero-forge';
export type ThemeColors = { [K in keyof typeof classicColors]: string };
const heroColors: ThemeColors = {
  backdrop: '#090D10', bg: '#101519', surface: '#20272D', ink: '#F1F3F4',
  muted: '#B5BDC4', faint: '#89959E', line: '#53616B', accent: '#FF9E42',
  accentSoft: '#35291E', onAccent: '#19130C', onInkAction: '#FFBD72',
  inkRaised: '#34404A', onInkMuted: '#B5BDC4', warm: '#78C9DF', scrim: 'rgba(0,0,0,0.65)',
  card: '#20272D', onCard: '#F1F3F4', onCardMuted: '#B5BDC4',
  priority: '#FFBD72', activated: '#78C9DF', sore: '#F0C46A', injured: '#FF9C9C',
  primary: '#FF9E42',
};
const typography = (colors: ThemeColors) => ({
  title: { fontSize: 32, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  body: { fontSize: 17, fontWeight: '600', color: colors.ink },
  detail: { fontSize: 14, fontWeight: '400', color: colors.muted },
  number: { fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>);
export const themes = {
  classic: { id: 'classic', label: 'Classic light', dark: false, colors: classicColors, type: typography(classicColors) },
  'hero-forge': { id: 'hero-forge', label: 'Hero Forge · Theme 01', dark: true, colors: heroColors, type: typography(heroColors) },
} as const;
export type Theme = { id: ThemeId; label: string; dark: boolean; colors: ThemeColors; type: ReturnType<typeof typography> };
export const resolveTheme = (value: unknown): ThemeId => value === 'classic' ? 'classic' : 'hero-forge';
export function useTheme(): ThemeChoice {
  return useContext(ThemeContext) ?? { ...themes['hero-forge'], setTheme: () => undefined, ready: true, saveError: false };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;
/** Minimum touch target in dp/pt (contract 01). */
export const touch = 48;

/** Styles are computed per context, never captured from a mutable global palette. */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (theme: Theme) => T) {
  return function useStyles() {
    const theme = useTheme();
    return useMemo(() => {
      const styles = factory(theme);
      // Metallic edging belongs to the theme; keep the original light styles unchanged.
      if (theme.dark) for (const style of Object.values(styles) as ViewStyle[]) {
        if (style.borderRadius && !style.borderWidth && (style.backgroundColor === theme.colors.surface || style.backgroundColor === theme.colors.card)) {
          style.borderWidth = 1; style.borderColor = theme.colors.line;
        }
      }
      return StyleSheet.create(styles);
    }, [theme]);
  };
}
