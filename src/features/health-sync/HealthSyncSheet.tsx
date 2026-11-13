import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { healthSyncClient, SyncError, type RemoteSnapshot, type ShareScope } from '../../healthSync/client';
import { categories, categoryLabels, OMITTED, type Category, type ShareRange, type SyncSnapshot } from '../../healthSync/payload';
import {
  aiInstruction,
  createShareLink,
  everythingMessage,
  shareEverything,
  credentialFor,
  ensureUserId,
  fullPayload,
  inspectRemote,
  listShareLinks,
  previewShare,
  revokeShareLink,
  syncNow,
  syncStatus,
  forgetLegacySettings,
  type EverythingResult,
  type SavedShare,
  type SharePreview,
  type SyncDeps,
  type SyncStatus,
  NO_ENROLLMENT_KEY,
} from '../../healthSync/service';
import { BUILD_API, BUILD_ENROLLMENT_KEY, DEV_BUILD } from '../../healthSync/config';
import { toLocalDate } from '../../plan/dates';
import { buildAiExport, databaseStart } from '../../export/aiExport';
import { localIsoTimestamp } from '../../format';
import { shareJson } from '../../platform/files';
import { random } from '../../platform/random';
import { secrets } from '../../platform/secrets';
import { shareText } from '../../platform/shareText';
import type { TrackingStore } from '../../storage/types';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';

const APP_VERSION = '0.1.0';
/** #136: whether this build carries an enrollment key (never shown; only needed to link a phone). */
const CAN_LINK = BUILD_ENROLLMENT_KEY.length > 0;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`);
const when = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};
const RANGES: { value: ShareRange; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 'all', label: 'All' },
];

type Span = { from: string; to: string } | null;
type Shape = {
  coverage?: { app?: Span; healthConnect?: Span };
  share?: { format?: string };
  measurements?: unknown[];
  food?: unknown[] | { days?: Record<string, number> };
  training?: { sessions?: unknown[] | Record<string, number>; exercises?: unknown[] };
};
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
/** What an export (#171: the synced snapshot, a link's data, or the detailed file) holds, in words. */
function Summary({ p, bytes, testID }: { p: unknown; bytes: number | null; testID: string }) {
  const { type } = useTheme();
  const v = (p ?? {}) as Shape;
  const app = v.coverage?.app ?? null;
  const hc = v.coverage?.healthConnect ?? null;
  const summary = v.share?.format === 'summary';
  const foodDays = Array.isArray(v.food) ? v.food.length : v.food?.days ? Object.values(v.food.days).reduce((a, b) => a + b, 0) : 0;
  const lines = [
    app ? `This phone’s records: ${app.from} to ${app.to}` : 'No records from this phone yet',
    hc ? `Health Connect history: ${hc.from} to ${hc.to}` : null,
    summary ? 'A summary of each measurement over this period' : `${count(v.measurements).toLocaleString()} measurements`,
    foodDays ? `${foodDays.toLocaleString()} days of food` : null,
    count(v.training?.exercises) || count(v.training?.sessions) ? `${count(v.training?.sessions) + count(v.training?.exercises)} training entries` : null,
    bytes !== null ? `About ${size(bytes)}` : null,
  ].filter((l): l is string => !!l);
  return (
    <View testID={testID}>
      {lines.map((l) => (
        <Text key={l} style={type.detail}>
          • {l}
        </Text>
      ))}
    </View>
  );
}

/**
 * Health data sync (#134): a private copy of your health data on your own server (Sync my data), and expiring,
 * read-only links for an AI (Share everything in one tap, #168; Advanced sharing to choose). Nothing is sent without a tap; nothing on this phone is changed by
 * looking at the server copy. The owner key stays in secure storage.
 */
export function HealthSyncSheet({ store, onClose }: { store: TrackingStore; onClose: () => void }) {
  const { type, colors } = useTheme();
  const styles = useStyles();
  const [page, setPage] = useState<'home' | 'share'>('home');
  const [linked, setLinked] = useState(false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState<{ snapshot: SyncSnapshot; bytes: number } | null>(null);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const [everything, setEverything] = useState<EverythingResult | null>(null);
  // Share
  const [range, setRange] = useState<ShareRange>(30);
  const [chosen, setChosen] = useState<Category[]>(['measurements', 'activity', 'sleep', 'nutrition', 'training']);
  const [hours, setHours] = useState<1 | 24>(24);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [link, setLink] = useState<SavedShare | null>(null);
  const [links, setLinks] = useState<SavedShare[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const deps = useCallback(
    (): SyncDeps => {
      const now = new Date();
      // #146: the build's API URL only (config.ts); there is no other source and no default.
      const base = BUILD_API.ok ? BUILD_API.url : '';
      return { store, client: healthSyncClient(base, (u, init) => fetch(u, init), { dev: DEV_BUILD }), secrets, now: () => new Date().toISOString(), today: toLocalDate(now), appVersion: APP_VERSION, uuid: random.uuid, randomKey: random.hexKey, enrollmentKey: BUILD_ENROLLMENT_KEY };
    },
    [store],
  );

  const refresh = useCallback(async () => {
    const id = await ensureUserId(store, random.uuid);
    const [cred, st] = await Promise.all([credentialFor(secrets, id), syncStatus(secrets), forgetLegacySettings(secrets)]);
    if (!alive.current) return;
    setLinked(!!cred);
    setStatus(st);
  }, [store]);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const prepareSync = () =>
    run('Preparing…', async () => {
      setRemote(null);
      if (!linked && !CAN_LINK) throw new Error(NO_ENROLLMENT_KEY);
      setConfirmSync(await fullPayload(deps()));
    });
  const doSync = () =>
    run(linked ? 'Uploading…' : 'Linking this phone and uploading…', async () => {
      const r = await syncNow(deps());
      setConfirmSync(null);
      await refresh();
      if (!r.ok) throw r.error;
      setNotice(r.linked ? 'Linked and uploaded' : 'Uploaded');
    });
  // #168: one tap. Sync, link everything for 24 hours, then the system share sheet. No link if the sync fails.
  const doShareEverything = () =>
    run('Updating your server copy…', async () => {
      setRemote(null);
      setConfirmSync(null);
      setEverything(null);
      if (!linked && !CAN_LINK) throw new Error(NO_ENROLLMENT_KEY);
      let r: EverythingResult;
      try {
        r = await shareEverything(deps(), (stage) => alive.current && setBusy(stage === 'sync' ? 'Updating your server copy…' : 'Creating a read-only link…'));
      } finally {
        await refresh().catch(() => undefined);
      }
      if (!alive.current) return;
      setEverything(r);
      setBusy('Opening share…');
      const shared = await shareText(everythingMessage(r), 'My health data');
      if (shared === 'copied') setNotice('Copied the link and instructions. Paste them into your AI chat.');
      else if (shared === 'unavailable') setNotice('Sharing isn’t available here. Copy the link below instead.');
      else setNotice(r.format === 'summary' ? 'Link ready: a summary of all your history (too long for one link in full).' : 'Link ready: all your history, read-only for 24 hours.');
    });
  const copyEverything = () =>
    run('Copying…', async () => {
      if (!everything) return;
      await Clipboard.setStringAsync(everythingMessage(everything));
      setNotice('Copied the link and instructions. Paste them into your AI chat.');
    });
  const revokeEverything = () =>
    run('Revoking…', async () => {
      if (!everything) return;
      await revokeShareLink(deps(), everything.link.id);
      setEverything(null);
      setNotice('Link revoked');
    });
  const viewRemote = () =>
    run('Downloading…', async () => {
      setRemote(await inspectRemote(deps()));
    });

  const scope = (): ShareScope => ({ range, categories: categories.filter((c) => chosen.includes(c)), format: 'records', expiresIn: hours * 3600 });
  const makePreview = () =>
    run('Preparing preview…', async () => {
      setLink(null);
      setPreview(await previewShare(deps(), scope()));
      setShowJson(false);
    });
  const createLink = () =>
    run('Creating link…', async () => {
      if (!preview?.revision) return;
      try {
        setLink(await createShareLink(deps(), scope(), preview.revision));
      } catch (e) {
        // The server copy changed since the preview (a sync in between): the link must match what was shown.
        if (e instanceof SyncError && e.kind === 'conflict') {
          setPreview(null);
          throw new Error('Your server copy changed since this preview. Preview again, then create the link.');
        }
        throw e;
      }
      setLinks(await listShareLinks(deps()));
    });
  const loadLinks = () =>
    run('Loading links…', async () => {
      setLinks(await listShareLinks(deps()));
    });
  const revoke = (id: string) =>
    run('Revoking…', async () => {
      await revokeShareLink(deps(), id);
      if (link?.id === id) setLink(null);
      setLinks(await listShareLinks(deps()));
      setNotice('Link revoked');
    });
  // #167: a detailed file for an AI, built on this phone: coverage by source, database start, meals and exercises.
  const shareDetailedFile = () =>
    run('Preparing the file…', async () => {
      const today = toLocalDate(new Date());
      const doc = buildAiExport(await store.snapshot(), {
        generatedAt: localIsoTimestamp(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
        today,
        appVersion: APP_VERSION,
        databaseStart: await databaseStart(store),
      });
      await shareJson(`body-anvil-ai-export-${today}.json`, JSON.stringify(doc, null, 1));
      setNotice('Shared the detailed file. Attach it to your AI chat.');
    });
  const copyAiLink = () =>
    run('Copying…', async () => {
      if (!link) return;
      await Clipboard.setStringAsync(aiInstruction(link.url, link.expiresAt));
      setNotice('Copied the link and instructions. Paste them into your AI chat.');
    });
  const shareAsText = () =>
    run('Opening share…', async () => {
      if (!preview) return;
      const r = await shareText(`Analyse my health data below: weight, waist, training and nutrition trends. Please identify the dates covered and any missing data.\n\n${JSON.stringify(preview.data)}`, 'My health data');
      if (r === 'unavailable') throw new Error('Sharing isn’t available on this phone.');
      if (r === 'copied') setNotice('Copied the data as text.');
    });

  const toggle = (c: Category) => {
    setPreview(null);
    setLink(null);
    setChosen((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  };
  const configured = BUILD_API.ok;

  return (
    <Sheet visible onClose={() => !busy && onClose()} label="Health data sync" fill>
      <ModalHeader title={page === 'home' ? 'Health data sync' : 'Advanced sharing'} dismiss={{ label: 'Close', a11yLabel: 'Close health data sync', onPress: () => !busy && onClose() }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="health-sync-sheet">
        {page === 'share' && <Button title="Back to health data sync" variant="quiet" onPress={() => { setPage('home'); setError(null); setNotice(null); }} />}
        {busy && (
          <View style={styles.progress} accessibilityLiveRegion="polite" testID="health-sync-busy">
            <ActivityIndicator />
            <Text style={[type.body, styles.flex]}>{busy}</Text>
          </View>
        )}
        {error && (
          <View style={[styles.panel, styles.errorPanel]} testID="health-sync-error" accessibilityLiveRegion="polite">
            <Text style={type.body}>{error}</Text>
          </View>
        )}
        {notice && !busy && (
          <Text style={type.detail} accessibilityLiveRegion="polite" testID="health-sync-notice">
            {notice}
          </Text>
        )}

        {page === 'home' && (
          <>
            <Text style={type.body}>Keep a private copy of your health data on your server, and make read-only links an AI can read.</Text>
            <Text style={type.detail}>Nothing is sent unless you tap. Your data on this phone is never changed by syncing or by looking at the server copy.</Text>

            <View style={styles.panel} testID="health-sync-status">
              <Text style={type.section}>Last sync</Text>
              <Text style={type.body}>{status?.lastSuccessAt ? `${when(status.lastSuccessAt)} · ${size(status.bytes)}` : 'Not synced yet'}</Text>
              {status && !status.ok && <Text style={[type.detail, { color: colors.injured }]}>Last try {when(status.at)}: {status.message}</Text>}
              <Text style={type.detail} testID="health-sync-link-state">
                {!BUILD_API.ok ? BUILD_API.message : linked ? 'This phone is linked.' : CAN_LINK ? 'Your first sync links this phone to the server.' : NO_ENROLLMENT_KEY}
              </Text>
            </View>

            {!confirmSync && <Button title="Sync my data" disabled={!!busy || !configured || (!linked && !CAN_LINK)} onPress={prepareSync} testID="health-sync-prepare" />}
            {confirmSync && (
              <View style={[styles.panel, styles.warnPanel]} testID="health-sync-confirm">
                <Text style={type.body}>This sends your complete history to your private server copy, replacing the last one:</Text>
                <Summary p={confirmSync.snapshot} bytes={confirmSync.bytes} testID="health-sync-contents" />
                <Text style={type.detail}>Not sent: {OMITTED.join('; ')}.</Text>
                <Button title={linked ? 'Upload now' : 'Link and upload'} disabled={!!busy} onPress={doSync} testID="health-sync-upload" />
                <Button title="Cancel" variant="quiet" disabled={!!busy} onPress={() => setConfirmSync(null)} />
              </View>
            )}
            <Button title="Share everything" variant="secondary" disabled={!!busy || !configured || (!linked && !CAN_LINK)} onPress={doShareEverything} testID="health-sync-share-everything" />
            <Text style={type.detail}>Syncs first, then shares all your history as a read-only link for 24 hours.</Text>
            {everything && (
              <View style={styles.panel} testID="everything-link">
                <Text style={type.section}>Link ready</Text>
                <Text style={styles.mono} selectable>
                  {everything.link.url}
                </Text>
                <Text style={type.detail}>
                  {everything.format === 'summary' ? 'A summary of all your history' : 'All your history'} · expires {when(everything.link.expiresAt)}
                </Text>
                <Button title="Copy AI link" variant="secondary" disabled={!!busy} onPress={copyEverything} testID="everything-copy" />
                <Button title="Revoke now" variant="quiet" disabled={!!busy} onPress={revokeEverything} testID="everything-revoke" />
              </View>
            )}
            <Button title="Advanced sharing" variant="quiet" disabled={!!busy || !configured} onPress={() => { setPage('share'); setError(null); setNotice(null); if (linked) loadLinks(); }} testID="health-sync-share" />
            <Button title="View the server copy" variant="quiet" disabled={!!busy || !linked || !configured} onPress={viewRemote} testID="health-sync-view" />
            {remote && (
              <View style={styles.panel} testID="health-sync-remote">
                <Text style={type.section}>On the server</Text>
                {/* The time comes in a response header, which browsers can't read unless the Worker exposes it (#163). */}
                <Text style={type.body}>{remote.updatedAt ? `Uploaded ${when(remote.updatedAt)}` : 'Your last upload'}</Text>
                <Summary p={remote.snapshot} bytes={null} testID="health-sync-remote-contents" />
                <Text style={type.detail}>For viewing only. It isn’t copied into this phone; to move data between phones use Back up data and Restore data.</Text>
              </View>
            )}

          </>
        )}

        {page === 'share' && (
          <>
            {!linked && <Text style={type.body}>Sync your data once first to link this phone. Then you can make links here.</Text>}
            <Text style={type.detail}>Make a read-only link to the data you choose, for ChatGPT, Claude, Gemini or another AI. It can’t change anything and it expires.</Text>
            <Text style={type.section}>Period</Text>
            <View style={styles.row} role="radiogroup" aria-label="Period">
              {RANGES.map((d) => (
                <Pressable key={d.label} role="radio" aria-checked={range === d.value} aria-label={d.label} onPress={() => { setRange(d.value); setPreview(null); setLink(null); }} style={[styles.chip, range === d.value && styles.selected]}>
                  <Text style={type.body}>{d.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={type.section}>What to include</Text>
            {categories.map((c) => (
              <Pressable key={c} role="checkbox" aria-checked={chosen.includes(c)} aria-label={categoryLabels[c].label} onPress={() => toggle(c)} style={[styles.option, chosen.includes(c) && styles.selected]} testID={`share-category-${c}`}>
                <Text style={type.body}>{chosen.includes(c) ? '☑' : '☐'} {categoryLabels[c].label}</Text>
                <Text style={type.detail}>{categoryLabels[c].detail}</Text>
              </Pressable>
            ))}
            <Text style={type.section}>Link expires after</Text>
            <View style={styles.row} role="radiogroup" aria-label="Link expires after">
              {([1, 24] as const).map((h) => (
                <Pressable key={h} role="radio" aria-checked={hours === h} aria-label={h === 1 ? '1 hour' : '24 hours'} onPress={() => { setHours(h); setLink(null); }} style={[styles.chip, hours === h && styles.selected]}>
                  <Text style={type.body}>{h === 1 ? '1 hour' : '24 hours'}</Text>
                </Pressable>
              ))}
            </View>
            {!preview && <Button title="Preview what’s shared" disabled={!!busy || chosen.length === 0} onPress={makePreview} testID="share-preview" />}
            {preview && (
              <View style={styles.panel} testID="share-preview-panel">
                <Text style={type.section}>Exactly this will be shared</Text>
                <Summary p={preview.data} bytes={preview.bytes} testID="share-contents" />
                <Text style={type.detail}>{preview.revision ? 'From your last sync. Sync again first to include anything newer.' : 'From this phone. Sync once to be able to make a link.'}</Text>
                <Text style={type.detail}>Never shared: {OMITTED.join('; ')}.</Text>
                <Button title={showJson ? 'Hide the data' : 'Show the data'} variant="quiet" onPress={() => setShowJson((s) => !s)} />
                {showJson && (
                  <Text style={styles.mono} selectable testID="share-json">
                    {JSON.stringify(preview.data, null, 1).slice(0, 4000)}
                    {JSON.stringify(preview.data, null, 1).length > 4000 ? '\n…' : ''}
                  </Text>
                )}
                <View style={[styles.panel, styles.warnPanel]}>
                  <Text style={type.body}>Anyone with the link can read this until it expires or you revoke it.</Text>
                  <Text style={type.detail}>Pasting it into an AI chat may keep the link and data in that service’s history. Expiry doesn’t remove copies already fetched.</Text>
                </View>
                {!link && <Button title="Create read-only link" disabled={!!busy || !linked || !preview.revision} onPress={createLink} testID="share-create" />}
                <Button title="Share as text instead" variant="secondary" disabled={!!busy} onPress={shareAsText} testID="share-text" />
                <Text style={type.detail}>Use text if your AI can’t open links.</Text>
              </View>
            )}
            {link && (
              <View style={styles.panel} testID="share-link">
                <Text style={type.section}>Link ready</Text>
                <Text style={styles.mono} selectable>
                  {link.url}
                </Text>
                <Text style={type.detail}>Expires {when(link.expiresAt)}</Text>
                <Button title="Copy AI link" disabled={!!busy} onPress={copyAiLink} testID="share-copy" />
                <Button title="Revoke now" variant="quiet" disabled={!!busy} onPress={() => revoke(link.id)} />
              </View>
            )}
            {links.length > 0 && (
              <View style={styles.panel} testID="share-links">
                <Text style={type.section}>Your links</Text>
                {links.map((l) => (
                  <View key={l.id} style={styles.linkRow}>
                    <Text style={type.body}>
                      {l.range === 'all' ? 'All history' : `${l.range} days`} · expires {when(l.expiresAt)}
                    </Text>
                    <Button title="Revoke" variant="quiet" disabled={!!busy} onPress={() => revoke(l.id)} />
                  </View>
                ))}
              </View>
            )}
            <View style={styles.panel} testID="share-detailed">
              <Text style={type.section}>Detailed file</Text>
              <Text style={type.detail}>Every measurement, meal and exercise with its time and source, and what your data covers (when this phone’s records start, and Health Connect history), as a file to attach to an AI chat. Made on this phone; nothing is uploaded.</Text>
              <Button title="Share a detailed file" variant="secondary" disabled={!!busy} onPress={shareDetailedFile} testID="share-detailed-file" />
            </View>
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.xl },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  panel: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  errorPanel: { borderColor: colors.injured },
  warnPanel: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: touch, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  option: { minHeight: touch, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, gap: 2 },
  selected: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  input: { minHeight: touch, padding: space.md, color: colors.ink, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, fontSize: 16 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: colors.ink },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
}));
