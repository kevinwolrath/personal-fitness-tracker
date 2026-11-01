import { KeyValueTrackingStore, MemoryKeyValue } from './keyValueStore';
import type { TrackingStore } from './types';

/** Web (dev/test surface): localStorage behind the same interface (contract 04). */
export async function openStore(): Promise<TrackingStore> {
  let kv: Storage | MemoryKeyValue;
  try {
    kv = window.localStorage;
    kv.getItem('probe');
  } catch {
    kv = new MemoryKeyValue(); // private mode / blocked storage: still usable, not persistent
  }
  return new KeyValueTrackingStore(kv);
}
