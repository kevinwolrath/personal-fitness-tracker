import { syncSummary } from '../summary';

const status = (lastSuccessAt: string | null) => ({ at: '2026-11-13T01:00:00.000Z', ok: true, bytes: 1, message: '', lastSuccessAt, uploadedAt: lastSuccessAt });

describe('#174: the menu’s Health data sync line', () => {
  const now = new Date(2026, 10, 13, 15, 0);
  it('leads with the one-tap share and says it has never synced', () => {
    expect(syncSummary(null, now)).toBe('Share everything with an AI · Not synced yet');
    expect(syncSummary(status(null), now)).toBe('Share everything with an AI · Not synced yet');
    expect(syncSummary(status('not a date'), now)).toBe('Share everything with an AI · Not synced yet');
  });
  it('says today, or the day and month (with the year when it is another year)', () => {
    expect(syncSummary(status(new Date(2026, 10, 13, 9, 0).toISOString()), now)).toBe('Share everything with an AI · Last synced today');
    expect(syncSummary(status(new Date(2026, 10, 2, 9, 0).toISOString()), now)).toMatch(/Last synced (2 Nov|Nov 2)$/);
    expect(syncSummary(status(new Date(2025, 11, 30, 9, 0).toISOString()), now)).toMatch(/2025$/);
  });
});
