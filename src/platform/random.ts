import * as Crypto from 'expo-crypto';
import { toHex } from './randomText';

/** Cryptographically secure randomness (native: expo-crypto). See random.web.ts. */
export const random = {
  uuid: () => Crypto.randomUUID(),
  /** 256 random bits as 64 lowercase hex characters. */
  hexKey: () => toHex(Crypto.getRandomBytes(32)),
};
