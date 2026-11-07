import manifest from '../../assets/exercises/heroes/manifest.json';

/** Pure metadata: validating library coverage never imports native image modules. */
export const illustrationIds: Record<string, true> = Object.fromEntries(manifest.map(({ id }) => [id, true]));
