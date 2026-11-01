import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localIsoTimestamp } from '../../format';
import { ClaudeScreenshotExtractor, ExtractionError, type ScreenshotExtractor, type ScreenshotInput } from '../../observations/claudeExtractor';
import { mapExtraction, type MappedScreenshot } from '../../observations/extraction';
import { buildObservations, type ReviewedCandidate } from '../../observations/review';
import type { ImportAsset, ImportSession } from '../../observations/types';
import type { LocalDate } from '../../plan/dates';
import { retainAsset } from '../../platform/files';
import { secrets } from '../../platform/secrets';
import { newId, type TrackingStore } from '../../storage/types';

export const API_KEY_SECRET = 'pft.anthropic.apiKey';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 3;

export type PickedScreenshot = {
  asset: ImportAsset;
  uri: string;
  input: ScreenshotInput | null;
  /** Problem with the file itself (too large, unsupported). */
  fileError: string | null;
  status: 'ready' | 'reading' | 'done' | 'failed';
  error: string | null;
  mapped: MappedScreenshot | null;
};

/** Identify the image type from its bytes, not the (sometimes wrong) reported MIME type. */
export function sniffMediaType(base64: string): ScreenshotInput['mediaType'] | null {
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('UklGR')) return 'image/webp';
  if (base64.startsWith('R0lG')) return 'image/gif';
  return null;
}

/** EXIF "2026:11:01 16:39:00" (local time) → ISO with the device offset. */
export function exifToIso(exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? null : localIsoTimestamp(d);
}

export function toPicked(a: ImagePicker.ImagePickerAsset): PickedScreenshot {
  const base64 = a.base64 ?? (a.uri.startsWith('data:') ? a.uri.slice(a.uri.indexOf(',') + 1) : null);
  const mediaType = base64 ? sniffMediaType(base64) : null;
  const bytes = base64 ? Math.floor((base64.length * 3) / 4) : 0;
  const fileError = !base64
    ? "This image couldn't be read."
    : !mediaType
      ? 'Use a PNG, JPEG, WebP or GIF screenshot.'
      : bytes > MAX_IMAGE_BYTES
        ? 'This image is larger than 5 MB.'
        : null;
  const asset: ImportAsset = {
    id: newId(),
    fileName: a.fileName ?? null,
    mimeType: mediaType ?? a.mimeType ?? null,
    capturedAt: exifToIso(a.exif),
    storedUri: null,
    sourceApp: null,
  };
  return {
    asset,
    uri: a.uri,
    input: fileError ? null : { base64: base64!, mediaType: mediaType!, fileName: asset.fileName, capturedAt: asset.capturedAt },
    fileError,
    status: fileError ? 'failed' : 'ready',
    error: fileError,
    mapped: null,
  };
}

/**
 * Open the platform image picker: images only, several at once. Resolves null when cancelled.
 * The picker is the selection dialog; there is no extra in-app step before it (#15).
 */
export async function pickScreenshots(): Promise<PickedScreenshot[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: 10,
    base64: true,
    exif: true,
    quality: 0.8,
  });
  return result.canceled || !result.assets.length ? null : result.assets.map(toPicked);
}

/**
 * Hand-off from the app menu to the import screen: the menu picks first, then opens /import.
 * Picked images (with base64) are too large for route params, so they wait here until the screen takes them.
 */
let pendingShots: PickedScreenshot[] | null = null;
export const handOffScreenshots = (shots: PickedScreenshot[]) => {
  pendingShots = shots;
};
export const takeHandedOffScreenshots = (): PickedScreenshot[] => {
  const shots = pendingShots ?? [];
  pendingShots = null;
  return shots;
};

/**
 * One screenshot-import session: pick → read (extract) → review → save (contract 06).
 * `makeExtractor` is injectable so tests and future sources (OCR, APIs) can replace Claude.
 */
export function useImportSession(opts: {
  store: TrackingStore;
  defaultDate: LocalDate;
  today: LocalDate;
  makeExtractor?: (apiKey: string) => ScreenshotExtractor;
  initialShots?: PickedScreenshot[];
}) {
  const { store, defaultDate, today } = opts;
  const makeExtractor = opts.makeExtractor ?? ((key: string) => new ClaudeScreenshotExtractor(key));

  const [apiKey, setApiKeyState] = useState<string | null | undefined>(undefined); // undefined = loading
  // Screenshots chosen from the app menu before this screen opened (pickScreenshots → handoff).
  const [shots, setShots] = useState<PickedScreenshot[]>(() => opts.initialShots ?? []);
  const [review, setReview] = useState<ReviewedCandidate[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const sessionId = useRef(newId());

  useEffect(() => {
    secrets.get(API_KEY_SECRET).then((k) => setApiKeyState(k ?? null), () => setApiKeyState(null));
  }, []);

  const saveApiKey = useCallback(async (key: string) => {
    await secrets.set(API_KEY_SECRET, key.trim());
    setApiKeyState(key.trim());
  }, []);
  const forgetApiKey = useCallback(async () => {
    await secrets.remove(API_KEY_SECRET);
    setApiKeyState(null);
  }, []);

  const pick = useCallback(async () => {
    const picked = await pickScreenshots();
    if (picked) setShots((s) => [...s, ...picked]);
  }, []);

  const removeShot = useCallback((assetId: string) => {
    setShots((s) => s.filter((x) => x.asset.id !== assetId));
    setReview((r) => r.filter((c) => c.assetId !== assetId));
  }, []);

  const readAll = useCallback(async () => {
    if (!apiKey) return;
    const extractor = makeExtractor(apiKey);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local';
    const queue = shots.filter((s) => s.input && (s.status === 'ready' || s.status === 'failed'));
    const update = (id: string, patch: Partial<PickedScreenshot>) =>
      setShots((all) => all.map((x) => (x.asset.id === id ? { ...x, ...patch } : x)));

    const run = async (shot: PickedScreenshot) => {
      update(shot.asset.id, { status: 'reading', error: null });
      try {
        const raw = await extractor.extract(shot.input!, { today, timeZone });
        const mapped = mapExtraction(shot.asset.id, raw, { defaultDate, today });
        update(shot.asset.id, { status: 'done', mapped, asset: { ...shot.asset, sourceApp: mapped.sourceApp } });
        setReview((r) => [...r.filter((c) => c.assetId !== shot.asset.id), ...mapped.candidates]);
      } catch (e) {
        const message = e instanceof ExtractionError ? e.message : 'Something went wrong reading this screenshot.';
        update(shot.asset.id, { status: 'failed', error: message });
      }
    };
    for (let i = 0; i < queue.length; i += CONCURRENCY) await Promise.all(queue.slice(i, i + CONCURRENCY).map(run));
  }, [apiKey, makeExtractor, shots, today, defaultDate]);

  const editCandidate = useCallback((key: string, patch: Partial<ReviewedCandidate>) => {
    setReview((r) => r.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    setErrors((e) => {
      const { [key]: _removed, ...rest } = e;
      return rest;
    });
  }, []);

  const setShotDate = useCallback((assetId: string, date: LocalDate) => {
    setReview((r) => r.map((c) => (c.assetId === assetId ? { ...c, date } : c)));
  }, []);

  /** Persist the confirmed values with provenance. Returns the number saved, or null on validation errors. */
  const save = useCallback(async (): Promise<number | null> => {
    const assets = await Promise.all(
      shots
        .filter((s) => s.status === 'done')
        .map(async (s) => {
          const ext = (s.asset.mimeType ?? 'image/png').split('/')[1] ?? 'png';
          const storedUri = await retainAsset(s.uri, sessionId.current, s.asset.id, ext).catch(() => null);
          return { ...s.asset, storedUri };
        }),
    );
    const session: ImportSession = {
      id: sessionId.current,
      createdAt: localIsoTimestamp(),
      extractor: makeExtractor(apiKey ?? '').id,
      assets,
    };
    const built = buildObservations(session, review, new Date().toISOString());
    if (!built.ok) {
      setErrors(built.errors);
      return null;
    }
    setSaving(true);
    try {
      await store.saveImport(session, built.observations);
    } finally {
      setSaving(false);
    }
    return built.observations.length;
  }, [shots, review, store, makeExtractor, apiKey]);

  return {
    apiKey,
    saveApiKey,
    forgetApiKey,
    shots,
    review,
    errors,
    saving,
    pick,
    removeShot,
    readAll,
    editCandidate,
    setShotDate,
    save,
    reading: shots.some((s) => s.status === 'reading'),
  };
}
