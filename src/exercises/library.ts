import data from './library.json';
import { illustrationIds } from './illustrationIds';
import { exerciseLibrarySchema, type ExerciseDefinition, type ExerciseLibrary } from './schema';

/** Validate a library: schema, unique ids, and every step image bundled. Pure. */
export function validateLibrary(input: unknown, assets: Record<string, unknown> = illustrationIds): { ok: true; library: ExerciseLibrary } | { ok: false; errors: string[] } {
  const r = exerciseLibrarySchema.safeParse(input);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of r.data.exercises) {
    if (seen.has(e.id)) errors.push(`exercise "${e.id}" is defined twice`);
    seen.add(e.id);
    for (const s of e.steps) if (!assets[s.image]) errors.push(`exercise "${e.id}": image "${s.image}" is not bundled`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, library: r.data };
}

const checked = validateLibrary(data);
if (!checked.ok) throw new Error(`Bundled exercise library is invalid:\n${checked.errors.join('\n')}`);

/** The bundled, app-owned exercise library. */
export const exerciseLibrary: ExerciseLibrary = checked.library;

export function findDefinition(movement: string, library: ExerciseLibrary = exerciseLibrary): ExerciseDefinition | undefined {
  return library.exercises.find((e) => e.id === movement);
}
