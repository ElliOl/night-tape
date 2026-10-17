/**
 * Soothing cassette colour schemes. Each song picks one (seeded, so a tape always looks the same), weighted toward
 * its station's colour family, the way the music draws its sounds.
 */
import type { MoodId } from '@shared/index';

export interface CassetteColors {
  /** shell */
  body: string;
  /** label panel behind the window */
  panel: string;
  /** band across the panel (none = plain panel) */
  stripe?: string;
  /** thin pinstripes under the band */
  pinstripe?: string;
  /** paper sticker with the title */
  sticker: string;
  /** colour of the title handwriting */
  ink: string;
  family: 'dusk' | 'cool' | 'warm' | 'pastel';
}

export const CASSETTE_PALETTES: readonly CassetteColors[] = [
  { body: '#2c2724', panel: '#f3e6cf', stripe: '#e8913a', sticker: '#fbf6ea', ink: '#3a2b22', family: 'dusk' },
  { body: '#efe3cc', panel: '#86cfc3', pinstripe: '#f5ecd9', sticker: '#fffaf0', ink: '#2f5d57', family: 'cool' },
  { body: '#2f4f8f', panel: '#f3e6cf', stripe: '#e8684a', pinstripe: '#f3e6cf', sticker: '#fffaf0', ink: '#2f3d66', family: 'cool' },
  { body: '#f2cf4a', panel: '#9b7fc7', sticker: '#fff8e8', ink: '#4f3a78', family: 'warm' },
  { body: '#b45cc9', panel: '#f6b6d6', sticker: '#ffffff', ink: '#4a1d55', family: 'pastel' },
  { body: '#9fb79a', panel: '#f4ecd8', stripe: '#d98c6a', sticker: '#fffaf0', ink: '#43553f', family: 'warm' },
  { body: '#7d9bb5', panel: '#f1e7d3', stripe: '#e3b34c', sticker: '#fffaf0', ink: '#34495c', family: 'cool' },
  { body: '#c96e4f', panel: '#f2dfc4', stripe: '#7aa7a0', sticker: '#fffaf0', ink: '#5a2f22', family: 'warm' },
  { body: '#8fc9b9', panel: '#fdf3e1', stripe: '#f19a7b', pinstripe: '#fdf3e1', sticker: '#ffffff', ink: '#2e5c50', family: 'pastel' },
  { body: '#6d4c6f', panel: '#e9c9d7', stripe: '#f2c27a', sticker: '#fff8ef', ink: '#4a2f4c', family: 'dusk' },
  { body: '#3d4a52', panel: '#c7d9d3', stripe: '#e9a66b', sticker: '#f8f4ea', ink: '#2c3940', family: 'dusk' },
  { body: '#f2b48c', panel: '#fff1e0', stripe: '#8bb0c9', sticker: '#ffffff', ink: '#6b3f26', family: 'pastel' },
  { body: '#7b7d4a', panel: '#efe2c2', stripe: '#d97b5a', sticker: '#fffaf0', ink: '#45462a', family: 'warm' },
  { body: '#b8a3d6', panel: '#fbf3e4', stripe: '#7cc1b7', pinstripe: '#fbf3e4', sticker: '#ffffff', ink: '#4f3f6b', family: 'pastel' },
  { body: '#4f6f6a', panel: '#e8dcc4', stripe: '#c9a96e', sticker: '#fbf6ea', ink: '#2f4542', family: 'cool' },
  { body: '#a8c3d9', panel: '#f7efe2', stripe: '#e9b3a8', sticker: '#ffffff', ink: '#3b5470', family: 'pastel' },
];

const FAMILY_WEIGHTS: Record<MoodId, Record<CassetteColors['family'], number>> = {
  study: { dusk: 4, warm: 2, cool: 2, pastel: 1 },
  rainy: { cool: 4, dusk: 2, pastel: 2, warm: 1 },
  sunday: { warm: 4, pastel: 3, cool: 1, dusk: 1 },
  drift: { pastel: 3, cool: 3, dusk: 1, warm: 1 },
};

function hash(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x2c, 0x01000193);
  }
  return h >>> 0;
}

function pickFor(seed: number, songIndex: number, mood: MoodId, salt: number): number {
  const w = FAMILY_WEIGHTS[mood];
  const total = CASSETTE_PALETTES.reduce((a, p) => a + w[p.family], 0);
  let r = (hash(seed, songIndex, 'cassette', salt) / 4294967296) * total;
  for (let i = 0; i < CASSETTE_PALETTES.length; i++) {
    r -= w[CASSETTE_PALETTES[i]!.family];
    if (r < 0) return i;
  }
  return 0;
}

/** Deterministic palette for a song: same seed + song -> same colours, never the same as the song before. */
export function cassetteColors(seed: number, songIndex: number, mood: MoodId): CassetteColors {
  const prev = songIndex > 0 ? pickFor(seed, songIndex - 1, mood, 0) : -1;
  let i = pickFor(seed, songIndex, mood, 0);
  for (let salt = 1; i === prev && salt < 8; salt++) i = pickFor(seed, songIndex, mood, salt);
  return CASSETTE_PALETTES[i]!;
}

/** Wobble seed for the hand-drawn outline (changes a little per song, like a different drawing). */
export const sketchSeed = (seed: number, songIndex: number): number => hash(seed, songIndex, 'sketch') % 997;
