import { useCallback, useRef, useState } from 'react';
import { localIsoTimestamp } from '../../format';
import type { MealPhoto } from '../../nutrition/contract';
import { QUICK_MEAL_PROMPT } from '../../nutrition/prompt';
import type { QuickContext } from '../../nutrition/quickLog';
import type { Plan } from '../../plan/schema';
import * as files from '../../platform/mealPhotos';
import { newId, type TrackingStore } from '../../storage/types';
import { systemPickers, type Pickers } from './useMealPhoto';

/** Read the remembered slot (#183). Damaged or missing → null. */
export async function readPending(): Promise<QuickContext | null> {
  try {
    const raw = await files.loadPendingShare();
    const c = raw ? (JSON.parse(raw) as QuickContext) : null;
    return c && typeof c.id === 'string' && typeof c.date === 'string' ? c : null;
  } catch {
    return null;
  }
}

/**
 * "📷 Take photo" (#183): the camera, then straight to the share chooser with the photo and the prompt together. No
 * wizard and no extra step: the user picks an AI app; its answer comes back through Android's share sheet to the
 * return page. The day and meal are remembered (they survive the app being killed while in the AI app).
 */
export function useTakeMealPhoto(opts: { store: TrackingStore; plan: Plan; pickers?: Pickers; now?: () => string }) {
  const { store, plan } = opts;
  const pickers = opts.pickers ?? systemPickers;
  const now = opts.now ?? (() => localIsoTimestamp());
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  const take = useCallback(async (target: { date: string; activityId: string | null }) => {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    try {
      const r = await pickers.camera();
      if (r.kind === 'cancelled') return; // back where they were, nothing kept
      if (r.kind === 'denied') return setNotice(r.canAskAgain ? 'Allow camera access to take a meal photo.' : 'Camera access is off. Allow it in the phone’s settings, or use Other ways to log in the meal’s details.');
      if (r.kind === 'failed' || !r.images.length) return setNotice("The camera couldn't open. Try again.");
      const img = r.images[0];
      const photoId = newId();
      let photo: MealPhoto;
      try {
        photo = { id: photoId, uri: await files.keepPhoto(img.uri, photoId), addedAt: now(), width: img.width, height: img.height };
      } catch {
        return setNotice("The photo couldn't be saved on this phone. Free some space and try again.");
      }
      // A photo from an earlier Take photo that never came back to Save is no longer needed.
      const previous = await readPending();
      if (previous?.photo && previous.photo.id !== photo.id) await files.deletePhoto(previous.photo.uri);
      const activity = target.activityId ? plan.activities.find((a) => a.id === target.activityId && a.kind === 'meal') : undefined;
      const ctx: QuickContext = { id: newId(), date: target.date, planId: activity ? plan.id : null, activityId: activity?.id ?? null, replacedLabel: activity?.label ?? null, photo, startedAt: now() };
      await files.savePendingShare(JSON.stringify(ctx));
      const shared = await files.sharePhotoWithText(photo.uri, QUICK_MEAL_PROMPT, 'Analyse this meal');
      if (shared === 'unavailable') setNotice("Sharing isn't available on this phone. Use Other ways to log in the meal's details.");
    } finally {
      busy.current = false;
    }
  }, [pickers, plan, store]); // eslint-disable-line react-hooks/exhaustive-deps

  return { take, notice, clearNotice: () => setNotice(null) };
}
