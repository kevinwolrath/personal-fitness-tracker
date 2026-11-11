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
import { interpretInput, type Interpretation } from '../../input/interpret';
import { combineUpdates } from '../../input/combine';

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'interpreted' }
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
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);

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
      setInterpretation(null);
    }
  }, []);

  const editText = useCallback((t: string) => {
    setInterpretation(null);
    setText(t);
    setCheck({ kind: 'idle' });
  }, []);

  /** Check `t` (default: the pasted text). A link (#120) passes its text, which also becomes the pasted text. */
  const checkText = useCallback((t: string) => {
    if (!raw) return;
    const text = t;
    const interpreted = interpretInput(text, raw);
    setInterpretation(interpreted);
    const updates = interpreted.intents.filter((entry) => entry.outcome === 'ACCEPT' && entry.update).map((entry) => entry.update!);
    if (!updates.length) {
      const rejected = interpreted.intents.filter((entry) => entry.kind === 'configuration_update' && entry.outcome === 'REJECT');
      if (rejected.length) {
        const original = parseConfigUpdate(text);
        if (!original.ok) return setCheck({ kind: 'invalid', errors: original.errors, recoverable: original.recoverable, diagnostics: original.diagnostics });
      }
      return setCheck({ kind: 'interpreted' });
    }
    const combined = combineUpdates(updates);
    if (!combined) {
      setInterpretation({ ...interpreted, intents: interpreted.intents.filter((entry) => !entry.update).concat({ kind: 'configuration_update', outcome: 'CLARIFY', source: text, fields: {}, message: 'These instructions assign conflicting values. Review one plan change at a time.' }) });
      return setCheck({ kind: 'interpreted' });
    }
    const parsed = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: combined.schemaVersion, ...combined.sections } }));
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
      notes: [...parsed.notes, ...interpreted.recovered],
    });
  }, [raw, energy]);
  const runCheck = useCallback(() => checkText(text), [checkText, text]);
  const checkLinkText = useCallback((t: string) => {
    setText(t);
    checkText(t);
  }, [checkText]);

  const apply = useCallback(async () => {
    if (!stored || check.kind !== 'preview' || !check.changeCount) return;
    setBusy(true);
    try {
      await commitConfigUpdate(store, stored, check.nextRaw, check.touched, check.payload);
      await reloadPlan();
      await refresh();
      setText('');
      setCheck({ kind: 'idle' });
      setInterpretation(null);
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

  return { stored, raw, history, text, check, busy, interpretation, sharePayload, pasteFromClipboard, editText, runCheck, checkLinkText, apply, undoLatest, copyDiagnostics };
}
