import { KeyValueTrackingStore, MemoryKeyValue, STORAGE_KEY } from '../keyValueStore';
import { describeTrackingStore } from './store.contract';

describeTrackingStore('key-value (web)', async () => {
  const kv = new MemoryKeyValue();
  return { store: new KeyValueTrackingStore(kv), reopen: async () => new KeyValueTrackingStore(kv) };
}, async () => new KeyValueTrackingStore(new MemoryKeyValue()));

it('recovers from corrupt stored data instead of crashing', async () => {
  const kv = new MemoryKeyValue();
  kv.setItem(STORAGE_KEY, '{not json');
  expect(await new KeyValueTrackingStore(kv).getActivePlan()).toBeNull();
});
