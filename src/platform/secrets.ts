import * as SecureStore from 'expo-secure-store';

/** Device keychain/keystore (native). See secrets.web.ts. */
export const secrets = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
