import { createHash, randomBytes } from 'node:crypto';
import { sha256 } from '../sha256';

it('matches Node crypto for every padding boundary and random data', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 100_003]) {
    const d = new Uint8Array(randomBytes(n));
    expect(sha256(d)).toBe(createHash('sha256').update(d).digest('hex'));
  }
  expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
