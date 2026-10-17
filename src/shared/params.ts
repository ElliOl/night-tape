import type { LayerId, MoodId } from './events';

/** User-facing composition controls. All 0..1 unless noted. */
export interface GenerationParams {
  mood: MoodId;
  /** busier drums, more layers */
  energy: number;
  /** "jazz": richer chord extensions, busier melodies */
  complexity: number;
  /** how much the patterns drift from bar to bar */
  variation: number;
  /** 0 = straight, 1 = heavy swing */
  swing: number;
  /** BPM override; null = per-song tempo from the mood */
  tempo: number | null;
  /** uint32 */
  seed: number;
}

/** Mixer faders 0..1 plus master. */
export type MixerParams = Record<LayerId, number> & { master: number };

/** Tape / ambience controls applied by the renderer (they never change the composition). 0..1. */
export interface TapeParams {
  /** master low-pass: 0 = muffled, 1 = open */
  warmth: number;
  /** wow & flutter depth */
  wow: number;
  /** bit-crush blend */
  crush: number;
  /** reverb amount */
  space: number;
  vinyl: number;
  rain: number;
  hiss: number;
}

export const DEFAULT_PARAMS: GenerationParams = {
  mood: 'study',
  energy: 0.5,
  complexity: 0.5,
  variation: 0.4,
  swing: 0.55,
  tempo: null,
  seed: 1337,
};

export const DEFAULT_MIXER: MixerParams = {
  keys: 0.72,
  pad: 0.55,
  bass: 0.7,
  melody: 0.6,
  drums: 0.68,
  texture: 0.6,
  master: 0.8,
};

export const DEFAULT_TAPE: TapeParams = {
  warmth: 0.55,
  wow: 0.35,
  crush: 0.15,
  space: 0.5,
  vinyl: 0.45,
  rain: 0.3,
  hiss: 0.25,
};
