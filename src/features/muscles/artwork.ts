import data from '../../../assets/hero-forge/app/muscle-regions.json';
export type Character = 'male' | 'female' | 'neutral';
export type BodyView = 'front' | 'back';
export const characterFor = (gender: unknown): Character => gender === 'male' || gender === 'female' ? gender : 'neutral';
export const regions: Record<Character, Record<BodyView, Record<string, string[]>>> = data.regions;
export const artwork = {
  male: { front: require('../../../assets/hero-forge/app/male-front.png'), back: require('../../../assets/hero-forge/app/male-back.png') },
  female: { front: require('../../../assets/hero-forge/app/female-front.png'), back: require('../../../assets/hero-forge/app/female-back.png') },
  neutral: { front: require('../../../assets/hero-forge/app/neutral-front.png'), back: require('../../../assets/hero-forge/app/neutral-back.png') },
} as const;
