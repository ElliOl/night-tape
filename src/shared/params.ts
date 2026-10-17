import type { LayerId, MoodId } from './events';

/** User-facing composition controls. All 0..1 unless noted. */
export interface GenerationParams {
  mood: MoodId;
  /** busier drums, more layers, harder playing */
  energy: number;
  /** "jazz": plain triads (0) .. lush 13ths (1), busier melodies */
  complexity: number;
  /** how much the patterns drift from bar to bar */
  variation: number;
  /** 0 = straight, 1 = heavy shuffle */
  swing: number;
  /** BPM override; null = per-song tempo from the mood */
  tempo: number | null;
  /** uint32 */
  seed: number;
}

export type FilterMode = 'lowpass' | 'bandpass' | 'highpass';
export const FILTER_MODES: readonly FilterMode[] = ['lowpass', 'bandpass', 'highpass'];

/** Mixer faders 0..1 plus master. */
export type MixerParams = Record<LayerId, number> & { master: number };

/** Tape / ambience / master filter controls applied by the renderer (never change the composition). 0..1. */
export interface TapeParams {
  /** tape low-pass: 0 = muffled, 1 = open */
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
  /** master filter cutoff (log 40 Hz .. 20 kHz) */
  cutoff: number;
  /** master filter resonance */
  resonance: number;
}

/** The chaotic LFO. */
export interface ChaosParams {
  /** overall depth 0..1 (0 = off) */
  amount: number;
  /** speed 0..1 (slow drift .. restless) */
  rate: number;
  /** which groups it may move */
  filter: boolean;
  tape: boolean;
  groove: boolean;
  /**
   * Wild cat: the cat leaves the scope and plays with mutes, stations and an acid filter.
   * 0 = off, 1 = reacts 1:1 to every swing of the LFO; in between it only answers the bigger ones, less often.
   */
  wildness: number;
}

/** Modulation targets of the chaos LFO. */
export type ModTarget =
  | 'cutoff' | 'resonance' | 'warmth' | 'wow' | 'crush' | 'space'
  | 'energy' | 'complexity' | 'variation' | 'swing';

export const DEFAULT_PARAMS: GenerationParams = {
  mood: 'study',
  energy: 0.5,
  complexity: 0.5,
  variation: 0.4,
  swing: 0.4,
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
  warmth: 0.6,
  wow: 0.3,
  crush: 0.1,
  space: 0.5,
  vinyl: 0.25,
  rain: 0.15,
  hiss: 0.15,
  cutoff: 1,
  resonance: 0.15,
};

export const DEFAULT_CHAOS: ChaosParams = {
  amount: 0.3,
  rate: 0.35,
  filter: true,
  tape: true,
  groove: true,
  wildness: 0,
};
