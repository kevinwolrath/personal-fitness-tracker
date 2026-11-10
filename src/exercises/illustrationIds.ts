import manifest from '../../assets/exercises/heroes/manifest.json';

/** Logical library steps; profile variants share a baseImage. No native image imports. */
export const illustrationIds: Record<string, true> = Object.fromEntries(manifest.map(({ baseImage }) => [baseImage, true]));
