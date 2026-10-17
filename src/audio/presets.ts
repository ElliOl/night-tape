/**
 * Per-mood sound design. Pure data (no Tone imports).
 *  - cutoffMin/cutoffMax (Hz): range the normalised `filter.<layer>` automation (0..1) is log-mapped onto.
 *  - filterDefault (0..1): position used until automation arrives.
 *  - levelDb: static output trim of the instrument.
 */
import type { LayerId, MoodId } from '@shared/index';

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface KeysPreset {
  /** FM e-piano: modulator ratio and brightness */
  harmonicity: number;
  modIndex: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** how fast the bell-like attack fades */
  modDecay: number;
  tremoloRate: number;
  tremoloDepth: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  chorusWet: number;
  levelDb: number;
}

export interface PadPreset {
  wave: Wave;
  spread: number;
  attack: number;
  release: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  lfoRate: number;
  lfoDepthCents: number;
  chorusWet: number;
  levelDb: number;
}

export interface BassPreset {
  wave: Wave;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  q: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** soft saturation drive */
  drive: number;
  levelDb: number;
}

export interface MelodyPreset {
  /** 0 = soft flute-ish sine, 1 = vibraphone / kalimba bell */
  bell: number;
  bellHarmonicity: number;
  bellModIndex: number;
  attack: number;
  release: number;
  vibratoRate: number;
  vibratoDepth: number;
  cutoffMin: number;
  cutoffMax: number;
  filterDefault: number;
  levelDb: number;
}

export interface DrumPreset {
  kickHz: number;
  kickDecay: number;
  kickPitchOct: number;
  kickDb: number;
  snareDb: number;
  snareDecay: number;
  snareToneHz: number;
  rimDb: number;
  hatDb: number;
  hatDecay: number;
  openHatDecay: number;
  shakerDb: number;
  /** muffled top end: the whole kit goes through this low-pass */
  ceilingHz: number;
  drive: number;
  levelDb: number;
}

export interface TexturePreset {
  /** mood scaling of the user ambience controls (dB added on top) */
  crackleDb: number;
  rainDb: number;
  hissDb: number;
  /** centre of the rain band */
  rainHz: number;
  levelDb: number;
}

export interface FxPreset {
  reverbReturnDb: number;
  reverbLpHz: number;
  reverbHpHz: number;
  delayBeats: number;
  delayFeedback: number;
  delayLpHz: number;
  delayReturnDb: number;
  /** how much of the echo also feeds the reverb */
  delayToReverb: number;
  reverbSend: Record<LayerId, number>;
  delaySend: Record<LayerId, number>;
}

export interface TapePreset {
  /** master tape saturation drive */
  drive: number;
  wowRate: number;
  flutterRate: number;
}

export interface MoodPreset {
  keys: KeysPreset;
  pad: PadPreset;
  bass: BassPreset;
  melody: MelodyPreset;
  drums: DrumPreset;
  texture: TexturePreset;
  fx: FxPreset;
  tape: TapePreset;
}

/** Crossfade time for mood changes. */
export const MOOD_RAMP_SECONDS = 2.5;
export const MAX_DELAY_SECONDS = 2;
export const REVERB_IR = { decay: 3.2, preDelay: 0.02, brightHz: 6500, darkHz: 1100 } as const;

const BASE: MoodPreset = {
  keys: {
    harmonicity: 1,
    modIndex: 3.2,
    attack: 0.004,
    decay: 2.2,
    sustain: 0.18,
    release: 1.1,
    modDecay: 0.35,
    tremoloRate: 3.6,
    tremoloDepth: 0.28,
    cutoffMin: 700,
    cutoffMax: 7000,
    filterDefault: 0.72,
    chorusWet: 0.3,
    levelDb: 0,
  },
  pad: {
    wave: 'triangle',
    spread: 18,
    attack: 1.6,
    release: 3,
    cutoffMin: 400,
    cutoffMax: 4000,
    filterDefault: 0.55,
    lfoRate: 0.07,
    lfoDepthCents: 500,
    chorusWet: 0.5,
    levelDb: -10,
  },
  bass: {
    wave: 'triangle',
    cutoffMin: 180,
    cutoffMax: 1400,
    filterDefault: 0.5,
    q: 0.9,
    attack: 0.008,
    decay: 0.5,
    sustain: 0.65,
    release: 0.18,
    drive: 1.6,
    levelDb: -6,
  },
  melody: {
    bell: 0.5,
    bellHarmonicity: 3.5,
    bellModIndex: 1.6,
    attack: 0.01,
    release: 1.2,
    vibratoRate: 4.8,
    vibratoDepth: 0.08,
    cutoffMin: 900,
    cutoffMax: 7000,
    filterDefault: 0.6,
    levelDb: -9,
  },
  drums: {
    kickHz: 52,
    kickDecay: 0.42,
    kickPitchOct: 3.2,
    kickDb: -4,
    snareDb: -12,
    snareDecay: 0.17,
    snareToneHz: 185,
    rimDb: -14,
    hatDb: -22,
    hatDecay: 0.045,
    openHatDecay: 0.28,
    shakerDb: -24,
    ceilingHz: 6500,
    drive: 1.8,
    levelDb: -3,
  },
  texture: { crackleDb: 0, rainDb: 0, hissDb: 0, rainHz: 1600, levelDb: 0 },
  fx: {
    reverbReturnDb: -8,
    reverbLpHz: 5000,
    reverbHpHz: 220,
    delayBeats: 0.75,
    delayFeedback: 0.32,
    delayLpHz: 2400,
    delayReturnDb: -10,
    delayToReverb: 0.3,
    reverbSend: { keys: 0.28, pad: 0.5, bass: 0, melody: 0.4, drums: 0.08, texture: 0.05 },
    delaySend: { keys: 0.06, pad: 0, bass: 0, melody: 0.28, drums: 0, texture: 0 },
  },
  tape: { drive: 1.3, wowRate: 0.55, flutterRate: 5.5 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(base: T, over: DeepPartial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(over as object)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge((base as any)[k], v as any);
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

export const PRESETS: Record<MoodId, MoodPreset> = {
  study: BASE,
  rainy: merge(BASE, {
    keys: { modIndex: 2.4, decay: 3, tremoloRate: 2.8, tremoloDepth: 0.35, filterDefault: 0.62, levelDb: 1 },
    pad: { levelDb: -8, filterDefault: 0.5 },
    melody: { bell: 0.25, release: 1.6, levelDb: -10 },
    drums: { ceilingHz: 4200, kickDecay: 0.5, snareDb: -15, rimDb: -12, levelDb: -6 },
    texture: { rainDb: 4, crackleDb: -2, rainHz: 1300 },
    fx: { reverbReturnDb: -6, delayFeedback: 0.38 },
    tape: { drive: 1.2, wowRate: 0.45 },
  }),
  sunday: merge(BASE, {
    keys: { modIndex: 3.8, modDecay: 0.45, tremoloDepth: 0.2, filterDefault: 0.8, levelDb: -0.5 },
    pad: { wave: 'sine', levelDb: -12 },
    melody: { bell: 0.8, bellHarmonicity: 4, levelDb: -9 },
    drums: { ceilingHz: 8000, kickDecay: 0.36, snareDb: -11, hatDb: -21 },
    texture: { rainDb: -8, crackleDb: 1 },
    fx: { reverbReturnDb: -10, delayBeats: 0.5 },
    tape: { drive: 1.4 },
  }),
  drift: merge(BASE, {
    keys: { modIndex: 1.8, decay: 4, sustain: 0.25, release: 2.5, tremoloRate: 2.2, tremoloDepth: 0.3, filterDefault: 0.55, levelDb: -1 },
    pad: { attack: 3, release: 5, levelDb: -6, filterDefault: 0.6, lfoRate: 0.04, chorusWet: 0.65 },
    bass: { wave: 'sine', filterDefault: 0.35, levelDb: -5 },
    melody: { bell: 0.6, attack: 0.03, release: 2.5, levelDb: -11 },
    drums: { ceilingHz: 3500, levelDb: -10 },
    texture: { rainDb: 2, crackleDb: -3, hissDb: 1 },
    fx: {
      reverbReturnDb: -4,
      delayBeats: 1.5,
      delayFeedback: 0.45,
      reverbSend: { keys: 0.55, pad: 0.7, bass: 0.05, melody: 0.6, drums: 0.2, texture: 0.1 },
      delaySend: { keys: 0.15, pad: 0.05, bass: 0, melody: 0.4, drums: 0, texture: 0 },
    },
    tape: { drive: 1.1, wowRate: 0.35 },
  }),
};

export const getPreset = (mood: MoodId): MoodPreset => PRESETS[mood] ?? BASE;
