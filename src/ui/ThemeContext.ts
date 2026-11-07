import { createContext } from 'react';
import type { Theme, ThemeId } from './theme';
export type ThemeChoice = Theme & { setTheme: (id: ThemeId) => void; ready: boolean; saveError: boolean };
export const ThemeContext = createContext<ThemeChoice | null>(null);
