import { toBase64Url } from './randomText';

/** Web: the browser's Web Crypto. */
export const random = {
  uuid: () => globalThis.crypto.randomUUID(),
  secret: () => toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32))),
};
