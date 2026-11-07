import { resolveTheme, themes } from '../theme';
const luminance = (hex: string) => {
  const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
it('defaults and unknown IDs use Hero Forge; Classic is an explicit persisted choice', () => {
  for (const value of [null, undefined, '', 'old-theme', 'hero-forge']) expect(resolveTheme(value)).toBe('hero-forge');
  expect(resolveTheme('classic')).toBe('classic');
});
it('both themes keep AA contrast for readable text and actions on their actual surfaces', () => {
  for (const theme of Object.values(themes)) {
    const c = theme.colors;
    for (const [fg, bg] of [[c.ink,c.bg],[c.ink,c.surface],[c.muted,c.surface],[c.onCard,c.card],[c.onAccent,c.primary],[c.accent,c.surface]]) {
      const values = [luminance(fg), luminance(bg)].sort((a,b) => b-a);
      expect((values[0]+0.05)/(values[1]+0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});
