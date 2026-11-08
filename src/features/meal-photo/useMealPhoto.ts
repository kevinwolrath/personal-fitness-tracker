import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localIsoTimestamp } from '../../format';
import type { MealLog, MealPhoto } from '../../nutrition/contract';
import { applyReply, blankItem, draftFromLog, draftMatches, finalizeDraft, manualEntry, newDraft, restoreDraft, STEPS, type DraftItem, type FieldError, type MealDraft, type Step } from '../../nutrition/draft';
import { mealPrompt } from '../../nutrition/prompt';
import { replacementCompletion } from '../../nutrition/replace';
import type { Plan } from '../../plan/schema';
import * as files from '../../platform/mealPhotos';
import { newId, type TrackingStore } from '../../storage/types';

export const MAX_PHOTOS = 6;

export type PickedImage = { uri: string; width: number | null; height: number | null };
export type PickResult = { kind: 'picked'; images: PickedImage[] } | { kind: 'cancelled' } | { kind: 'denied'; canAskAgain: boolean } | { kind: 'failed' };

/** The camera and the gallery, injectable for tests. */
export type Pickers = { camera: () => Promise<PickResult>; library: (max: number) => Promise<PickResult> };

const toPicked = (r: ImagePicker.ImagePickerResult): PickResult =>
  r.canceled || !r.assets.length ? { kind: 'cancelled' } : { kind: 'picked', images: r.assets.map((a) => ({ uri: a.uri, width: a.width ?? null, height: a.height ?? null })) };

export const systemPickers: Pickers = {
  async camera() {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { kind: 'denied', canAskAgain: perm.canAskAgain };
      return toPicked(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, exif: false }));
    } catch {
      return { kind: 'failed' };
    }
  },
  async library(max) {
    try {
      return toPicked(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: max > 1, selectionLimit: max, quality: 0.7, exif: false }));
    } catch {
      return { kind: 'failed' };
    }
  },
};

export const openSettings = () => Linking.openSettings().catch(() => undefined);

export type Target = { date: string; activityId: string | null; editId: string | null };

type Status =
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** A different unsaved meal is waiting: continue it or discard it. Never discarded silently. */
  | { kind: 'other-draft'; other: MealDraft }
  | { kind: 'not-found' };

/**
 * The "Log different meal" wizard (#97, contract 15). The draft is written to app storage on every change, so
 * leaving for the AI app, the app being killed or a restart all come back to the same step with the same photos
 * and paste. Saving is idempotent (the meal id is fixed when the draft starts) and guarded against double taps.
 */
export function useMealPhoto(opts: { store: TrackingStore; plan: Plan; target: Target; pickers?: Pickers; now?: () => string }) {
  const { store, plan, target } = opts;
  const pickers = opts.pickers ?? systemPickers;
  const now = opts.now ?? (() => localIsoTimestamp());
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [draft, setDraftState] = useState<MealDraft | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraDenied, setCameraDenied] = useState<null | { canAskAgain: boolean }>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const current = useRef<MealDraft | null>(null);

  const setDraft = useCallback((next: MealDraft | null) => {
    current.current = next;
    setDraftState(next);
    if (next) files.saveDraft(JSON.stringify(next)).catch(() => undefined);
  }, []);
  const update = useCallback((fn: (d: MealDraft) => MealDraft) => {
    if (current.current) setDraft({ ...fn(current.current), updatedAt: now() });
  }, [setDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkPhotos = useCallback(async (d: MealDraft) => {
    const exists = await Promise.all(d.photos.map((p) => files.photoExists(p.uri)));
    setMissing(d.photos.filter((_, i) => !exists[i]).map((p) => p.id));
  }, []);

  const start = useCallback(async (): Promise<MealDraft | null> => {
    if (target.editId) {
      const log = (await store.mealLogs({ from: target.date, to: target.date })).find((m) => m.id === target.editId) ?? (await store.mealLogs()).find((m) => m.id === target.editId);
      return log ? draftFromLog(log, now()) : null;
    }
    const activity = target.activityId ? plan.activities.find((a) => a.id === target.activityId && a.kind === 'meal') : undefined;
    return newDraft({ id: newId(), date: target.date, planId: activity ? plan.id : null, activityId: activity?.id ?? null, replacedLabel: activity?.label ?? null, now: now() });
  }, [store, plan, target.date, target.activityId, target.editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resume the saved draft for this meal, or start one. Another meal's unsaved draft is offered, never dropped.
  useEffect(() => {
    let live = true;
    (async () => {
      const saved = restoreDraft(await files.loadDraft());
      if (!live) return;
      if (saved && draftMatches(saved, target)) {
        setDraft(saved);
        setStatus({ kind: 'ready' });
        checkPhotos(saved);
        return;
      }
      if (saved && (saved.photos.length || saved.reply || saved.items.length)) {
        setStatus({ kind: 'other-draft', other: saved });
        return;
      }
      const d = await start();
      if (!live) return;
      if (!d) return setStatus({ kind: 'not-found' });
      setDraft(d);
      setStatus({ kind: 'ready' });
      checkPhotos(d);
    })();
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveOther = useCallback(async (choice: 'continue' | 'discard') => {
    if (status.kind !== 'other-draft') return;
    if (choice === 'continue') {
      setDraft(status.other);
      setStatus({ kind: 'ready' });
      checkPhotos(status.other);
      return 'switched' as const;
    }
    await discardPhotos(status.other);
    const d = await start();
    if (!d) return setStatus({ kind: 'not-found' });
    setDraft(d);
    setStatus({ kind: 'ready' });
    return 'discarded' as const;
  }, [status, start, setDraft, checkPhotos]);

  // A notice belongs to the step it was shown on.
  const goTo = useCallback((step: Step) => {
    setNotice(null);
    update((d) => ({ ...d, step }));
  }, [update]);
  const back = useCallback(() => {
    setNotice(null);
    update((d) => {
    const i = STEPS.indexOf(d.step);
    // With photos already taken, Back from the photos step doesn't return to the empty capture choice.
      return { ...d, step: i > 0 ? STEPS[i - 1] : d.step };
    });
  }, [update]);

  const addPhotos = useCallback(async (source: 'camera' | 'library') => {
    const d = current.current;
    if (!d || busy.current) return;
    const room = MAX_PHOTOS - d.photos.length;
    if (room <= 0) return setNotice(`A meal can have up to ${MAX_PHOTOS} photos.`);
    setNotice(null);
    busy.current = true;
    try {
      const r = source === 'camera' ? await pickers.camera() : await pickers.library(room);
      if (r.kind === 'denied') return setCameraDenied({ canAskAgain: r.canAskAgain });
      if (r.kind === 'failed') return setNotice(source === 'camera' ? "The camera couldn't open. Try again, or choose from the gallery." : "The gallery couldn't open. Try again.");
      if (r.kind === 'cancelled') return;
      setCameraDenied(null);
      const kept: MealPhoto[] = [];
      for (const img of r.images.slice(0, room)) {
        const id = newId();
        try {
          kept.push({ id, uri: await files.keepPhoto(img.uri, id), addedAt: now(), width: img.width, height: img.height });
        } catch {
          setNotice("A photo couldn't be saved on this phone. Free some space and try again.");
        }
      }
      if (r.images.length > room) setNotice(`Only ${room} more photo${room === 1 ? '' : 's'} fit: a meal can have up to ${MAX_PHOTOS}.`);
      if (kept.length) update((x) => ({ ...x, photos: [...x.photos, ...kept], addedPhotoIds: [...x.addedPhotoIds, ...kept.map((p) => p.id)], step: x.step === 'capture' ? 'photos' : x.step }));
    } finally {
      busy.current = false;
    }
  }, [pickers, update]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Remove a photo from the meal. A photo added in this draft is deleted now; a saved one only once Save confirms it. */
  const removePhoto = useCallback(async (id: string) => {
    const d = current.current;
    const p = d?.photos.find((x) => x.id === id);
    if (!d || !p) return;
    const added = d.addedPhotoIds.includes(id);
    if (added) await files.deletePhoto(p.uri);
    setMissing((m) => m.filter((x) => x !== id));
    update((x) => ({
      ...x,
      photos: x.photos.filter((y) => y.id !== id),
      addedPhotoIds: x.addedPhotoIds.filter((y) => y !== id),
      removedPhotos: added ? x.removedPhotos : [...x.removedPhotos, p],
      step: x.photos.length === 1 && x.step === 'photos' ? 'capture' : x.step,
    }));
  }, [update]);

  const prompt = draft ? mealPrompt(Math.max(1, draft.photos.filter((p) => !missing.includes(p.id)).length)) : mealPrompt();

  const copyPrompt = useCallback(async () => {
    const ok = await files.copyText(prompt);
    setNotice(ok ? 'Prompt copied. Paste it into the AI chat with the photo.' : "Couldn't copy the prompt. Use “See the prompt” and copy it by hand.");
    if (ok) update((d) => ({ ...d, promptCopied: true }));
    return ok;
  }, [prompt, update]);

  /**
   * Share with AI: the prompt goes to the clipboard first (the system share can't send text with a photo), then the
   * photo opens the system share sheet. Nothing leaves the phone until the user picks an app there.
   */
  const share = useCallback(async (photoIndex = 0) => {
    const d = current.current;
    const shareable = d?.photos.filter((p) => !missing.includes(p.id)) ?? [];
    const p = shareable[photoIndex];
    if (!d || !p) return setNotice('There is no photo to share. Add one, or copy the prompt and describe the meal to the AI.');
    const copied = await files.copyText(prompt);
    const r = await files.sharePhoto(p.uri, 'Share meal photo with AI');
    if (r === 'unavailable') {
      setNotice(copied ? "This phone can't share the photo from here. The prompt is copied: open your AI app, attach the photo from your gallery and paste the prompt." : "Sharing isn't available here. Use Copy prompt, then attach the photo in your AI app.");
      if (copied) update((x) => ({ ...x, promptCopied: true }));
      return;
    }
    if (r === 'dismissed') return setNotice(copied ? 'Not shared. The prompt is still copied.' : null);
    setNotice(copied ? 'Prompt copied. In the AI app, paste it with the photo, then copy the whole reply.' : 'Photo shared. Use Copy prompt and paste it in the same chat.');
    update((x) => ({ ...x, shared: true, promptCopied: copied || x.promptCopied }));
  }, [missing, prompt, update]);

  const setReply = useCallback((reply: string) => update((d) => ({ ...d, reply, replyError: null })), [update]);
  const pasteFromClipboard = useCallback(async () => {
    const t = await files.readClipboard();
    if (!t) return setNotice('The clipboard is empty. Copy the AI’s whole reply first.');
    setNotice(null);
    update((d) => ({ ...d, reply: t, replyError: null }));
  }, [update]);
  const checkReply = useCallback(() => {
    setNotice(null);
    update((d) => applyReply(d, d.reply, now()));
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps
  const enterManually = useCallback(() => {
    setNotice(null);
    update((d) => manualEntry(d, now()));
  }, [update]); // eslint-disable-line react-hooks/exhaustive-deps

  const setName = useCallback((name: string) => update((d) => ({ ...d, name })), [update]);
  const editItem = useCallback((key: string, patch: Partial<DraftItem>) => {
    setErrors((e) => e.filter((x) => x.key !== key));
    update((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  }, [update]);
  const addItem = useCallback(() => update((d) => ({ ...d, items: [...d.items, blankItem()] })), [update]);
  const removeItem = useCallback((key: string) => update((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) })), [update]);

  /** Save: the meal log and (for a new replacement) the scheduled meal's completion, in one write. */
  const save = useCallback(async (): Promise<MealLog | null> => {
    const d = current.current;
    if (!d || busy.current) return null;
    const r = finalizeDraft(d, now());
    if (!r.ok) {
      setErrors(r.errors);
      return null;
    }
    busy.current = true;
    setSaving(true);
    setErrors([]);
    try {
      const completion = d.activityId && d.planId === plan.id ? replacementCompletion(plan, d.date, await store.getDay(plan.id, d.date), d.activityId, true, now()) : null;
      await store.saveMealLog(r.log, completion);
      await Promise.all(r.removedPhotos.map((p) => files.deletePhoto(p.uri)));
      current.current = null;
      await files.clearDraft();
      return r.log;
    } catch {
      setNotice("Couldn't save. Your entries are kept: try again.");
      return null;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [store, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cancel: photos taken in this draft are deleted (they were never saved); saved photos are untouched. */
  const cancel = useCallback(async () => {
    const d = current.current;
    current.current = null;
    if (d) await discardPhotos(d);
    await files.clearDraft();
  }, []);

  const hasWork = !!draft && (draft.addedPhotoIds.length > 0 || !!draft.reply.trim() || draft.removedPhotos.length > 0 || (draft.mode === 'new' && draft.items.length > 0) || draft.mode === 'edit');

  return {
    status, draft, missing, notice, setNotice, cameraDenied, errors, saving, prompt, hasWork,
    actions: { resolveOther, goTo, back, addPhotos, removePhoto, copyPrompt, share, setReply, pasteFromClipboard, checkReply, enterManually, setName, editItem, addItem, removeItem, save, cancel },
  };
}

async function discardPhotos(d: MealDraft) {
  await Promise.all(d.photos.filter((p) => d.addedPhotoIds.includes(p.id)).map((p) => files.deletePhoto(p.uri)));
}
