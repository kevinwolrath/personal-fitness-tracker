import type { TrackingStore } from './types';

const writes = new Set(['setActivePlan','setActivity','setDayOverride','addObservations','removeObservation','replaceIntegrationObservations','saveImport','addQuickLog','removeQuickLog','applyConfigChange','logCompletion','addExerciseLog','removeExerciseLog','addMuscleReport','clearMuscleReport','saveMealLog','removeMealLog','restore']);
/** Notify only after a successful committed mutation, including edits, imports and undo. Reads retain their receiver. */
export function observableStore(store: TrackingStore, changed: () => void): TrackingStore {
  return new Proxy(store, { get(target, key) {
    const value = Reflect.get(target,key);
    if (typeof value !== 'function') return value;
    return (...args: unknown[]) => {
      const result = value.apply(target,args);
      return writes.has(String(key)) ? Promise.resolve(result).then(v => { changed(); return v; }) : result;
    };
  } });
}
