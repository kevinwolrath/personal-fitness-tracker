import * as Crypto from 'expo-crypto';
import { toBase64Url } from './randomText';

/** Cryptographically secure randomness (native: expo-crypto). See random.web.ts. */
export const random = {
  uuid: () => Crypto.randomUUID(),
  /** 256 random bits as base64url text. */
  secret: () => toBase64Url(Crypto.getRandomBytes(32)),
};
