import { toHex } from './randomText';

/** Web: the browser's Web Crypto. */
export const random = {
  uuid: () => globalThis.crypto.randomUUID(),
  /** 256 random bits as 64 lowercase hex characters. */
  hexKey: () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))),
};
