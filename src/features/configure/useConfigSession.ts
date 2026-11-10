import { importDiagnostics } from '../../config/import';
import type { EnergyDisplay } from '../../energy';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { previewUpdate, type SectionPreview } from '../../config/diff';
import { buildConfigShare } from '../../config/instructions';
import type { RawPlan, SectionName } from '../../config/sections';
import { commitConfigUpdate, undoConfigChange } from '../../config/service';
import { applyConfigUpdate, parseConfigUpdate } from '../../config/update';
import { toLocalDate } from '../../plan/dates';
import type { ConfigChange, StoredPlan, TrackingStore } from '../../storage/types';

export type CheckState =
  | { kind: 'idle' }
  /** recoverable: sections complete before a cut (never applied); diagnostics: copyable text for the AI (#47). */
  | { kind: 'invalid'; errors: string[]; recoverable: string[]; diagnostics: string }
  /** notes: what the import fixed automatically (#47), shown behind "Details". */
  | { kind: 'preview'; sections: SectionPreview[]; nextRaw: RawPlan; touched: SectionName[]; payload: unknown; changeCount: number; notes: string[] };

/** Copy → paste → check → preview → apply (contract 07). Nothing is written until `apply`. */
export function useConfigSession(store: TrackingStore, reloadPlan: () => Promise<void>, energy: EnergyDisplay) {
  const [stored, setStored] = useState<StoredPlan | null>(null);
  const [history, setHistory] = useState<ConfigChange[]>([]);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [p, h] = await Promise.all([store.getActivePlan(), store.configHistory()]);
    setStored(p);
    setHistory(h);
  }, [store]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const raw: RawPlan | null = stored ? JSON.parse(stored.json) : null;

  /** The exact text Share and Copy hand over (#119); built once per preview so what is shown is what is shared. */
  const sharePayload = useCallback(() => (raw ? buildConfigShare(raw, toLocalDate(new Date())) : ''), [raw]);

  const pasteFromClipboard = useCallback(async () => {
    const t = await Clipboard.getStringAsync();
    if (t) {
      setText(t);
      setCheck({ kind: 'idle' });
    }
  }, []);

  const editText = useCallback((t: string) => {
    setText(t);
    setCheck({ kind: 'idle' });
  }, []);

  const runCheck = useCallback(() => {
    if (!raw) return;
    const parsed = parseConfigUpdate(text);
    if (!parsed.ok) return setCheck({ kind: 'invalid', errors: parsed.errors, recoverable: parsed.recoverable, diagnostics: parsed.diagnostics });
    const applied = applyConfigUpdate(raw, parsed.update);
    if (!applied.ok) {
      return setCheck({ kind: 'invalid', errors: applied.errors, recoverable: [], diagnostics: importDiagnostics(text, { errors: applied.errors, notes: parsed.notes }) });
    }
    const sections = previewUpdate(raw, applied.nextRaw, parsed.update, energy);
    setCheck({
      kind: 'preview',
      sections,
      nextRaw: applied.nextRaw,
      touched: applied.touched,
      payload: parsed.json,
      changeCount: sections.reduce((n, s) => n + s.lines.length, 0),
      notes: parsed.notes,
    });
  }, [raw, text, energy]);

  const apply = useCallback(async () => {
    if (!stored || check.kind !== 'preview' || !check.changeCount) return;
    setBusy(true);
    try {
      await commitConfigUpdate(store, stored, check.nextRaw, check.touched, check.payload);
      await reloadPlan();
      await refresh();
      setText('');
      setCheck({ kind: 'idle' });
    } finally {
      setBusy(false);
    }
  }, [stored, check, store, reloadPlan, refresh]);

  const undoLatest = useCallback(async () => {
    if (!stored || !history[0]) return;
    setBusy(true);
    try {
      await undoConfigChange(store, stored, history[0]);
      await reloadPlan();
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [stored, history, store, reloadPlan, refresh]);

  /** Copy the failed import's details for the AI (#47). */
  const copyDiagnostics = useCallback(async () => {
    if (check.kind === 'invalid') await Clipboard.setStringAsync(check.diagnostics);
  }, [check]);

  return { stored, raw, history, text, check, busy, sharePayload, pasteFromClipboard, editText, runCheck, apply, undoLatest, copyDiagnostics };
}
