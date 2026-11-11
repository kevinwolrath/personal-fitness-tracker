import { deepEqual } from '../config/import/parse';
import { isMerge, type SectionName } from '../config/sections';
import type { ConfigUpdate } from '../config/update';

/** Independent proposals share one preview. Conflicting assignments require clarification. */
export function combineUpdates(updates: ConfigUpdate[]): ConfigUpdate | null {
  const combined: ConfigUpdate = { schemaVersion: updates[0].schemaVersion, sections: {} };
  for (const update of updates) {
    for (const [section, fields] of Object.entries(update.sections)) {
      const target = combined.sections[section as SectionName] ??= {};
      for (const [field, value] of Object.entries(fields!)) {
        if (!(field in target) || deepEqual(target[field], value)) { target[field] = value; continue; }
        const before = target[field];
        if (!isMerge(before) || !isMerge(value)) return null;
        const items = [...before.merge];
        for (const item of value.merge) {
          const existing = items.find((entry) => entry.id === item.id);
          if (existing && !deepEqual(existing, item)) return null;
          if (!existing) items.push(item);
        }
        target[field] = { merge: items };
      }
    }
  }
  return combined;
}
