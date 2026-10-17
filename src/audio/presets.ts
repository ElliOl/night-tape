/**
 * Per-mood sound design. Pure data (no Tone imports).
 *  - cutoffMin/cutoffMax (Hz): range the normalised `filter.<layer>` automation (0..1) is log-mapped onto.
 *  - filterDefault (0..1): position used until automation arrives.
 *  - levelDb: static output trim of the instrument.
 */
import type { BassPatchId, KeysPatchId, KitId, LayerId, LeadPatchId, MoodId, PadPatchId } from '@shared/index';

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

export interface KeysPreset {
  /** 'fm' = FM tine/bell engine, 'sub' = subtractive (oscillator -> resonant low-pass with its own envelope) */
  engine: 'fm' | 'sub';
  /** sub engine oscillator, e.g. 'triangle', 'fatsawtooth', 'square' */
  subWave: string;
  /** sub engine filter: start frequency, how far the envelope opens it, its decay / sustain and resonance */
  envBaseHz: number;
  envOctaves: number;
  envDecay: number;
  envSustain: number;
  subQ: number;
  /** FM e-piano: modulator ratio and brightness */
  harmonicity: number;
  modIndex: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** how fast the bell-like attack fades */
  modDecay: number;
  modSustain: number;
  modWave: Wave;
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
  bellDecay: number;
  softWave: Wave;
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
  /** how fast the kick's pitch drops (short = punchy, long = 808 boom) */
  kickPitchDecay: number;
  /** level of the beater click (dB; <= -60 = off) */
  kickClickDb: number;
  kickDb: number;
  snareDb: number;
  snareDecay: number;
  snareToneHz: number;
  /** centre of the snare's noise band */
  snareHz: number;
  snareNoise: 'white' | 'pink' | 'brown';
  /** slow attack = brush swish */
  snareAttack: number;
  /** resonance of the snare band (high = ringy) */
  snareQ: number;
  /** tonal body level relative to the snare (dB) */
  snareBodyDb: number;
  clapDb: number;
  rimDb: number;
  rideDb: number;
  hatHpHz: number;
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
    engine: 'fm',
    subWave: 'triangle',
    envBaseHz: 300,
    envOctaves: 3,
    envDecay: 0.3,
    envSustain: 0.2,
    subQ: 1,
    harmonicity: 1,
    modIndex: 3.2,
    attack: 0.004,
    decay: 2.2,
    sustain: 0.18,
    release: 1.1,
    modDecay: 0.35,
    modSustain: 0.12,
    modWave: 'sine',
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
    bellDecay: 1.4,
    softWave: 'sine',
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
    kickPitchDecay: 0.045,
    kickClickDb: -70,
    kickDecay: 0.42,
    kickPitchOct: 3.2,
    kickDb: -4,
    snareDb: -12,
    snareDecay: 0.17,
    snareToneHz: 185,
    snareHz: 1900,
    snareNoise: 'pink',
    snareAttack: 0.002,
    snareQ: 1.2,
    snareBodyDb: -4,
    clapDb: -12,
    rimDb: -14,
    rideDb: -22,
    hatHpHz: 6500,
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

// ---------------------------------------------------------------------------------------------
// patches: every song picks one per instrument (see composition/form.ts pickStyle).
// A patch overrides timbre parameters of the station preset; `trimDb` is added to its level.
// ---------------------------------------------------------------------------------------------

type Patch<T> = Partial<Omit<T, 'levelDb'>> & { trimDb?: number };

/** Keys patches: two engines and very different envelopes, so a song on clav is nothing like one on a Rhodes. */
export const KEYS_PATCHES: Record<KeysPatchId, Patch<KeysPreset>> = {
  // ---- FM engine
  rhodes: { engine: 'fm', harmonicity: 1, modIndex: 3.2, modWave: 'sine', attack: 0.004, decay: 2.2, sustain: 0.18, release: 1.1, modDecay: 0.35, modSustain: 0.12, tremoloRate: 3.6, tremoloDepth: 0.28, chorusWet: 0.3, cutoffMax: 7000, filterDefault: 0.72 },
  wurli: { engine: 'fm', harmonicity: 1, modIndex: 5.5, modWave: 'triangle', attack: 0.003, decay: 1.4, sustain: 0.3, release: 0.8, modDecay: 0.18, modSustain: 0.2, tremoloRate: 5.6, tremoloDepth: 0.45, chorusWet: 0.15, cutoffMax: 9000, filterDefault: 0.75, trimDb: -3 },
  vibes: { engine: 'fm', harmonicity: 4, modIndex: 1.8, modWave: 'sine', attack: 0.003, decay: 2.8, sustain: 0.05, release: 1.6, modDecay: 0.6, modSustain: 0.05, tremoloRate: 5.2, tremoloDepth: 0.4, chorusWet: 0.2, cutoffMax: 9000, filterDefault: 0.75, trimDb: -1 },
  // hammered old upright: low-ratio FM with a fast-fading brightness and almost no sustain
  piano: { engine: 'fm', harmonicity: 2, modIndex: 1.6, modWave: 'sine', attack: 0.002, decay: 2.6, sustain: 0.03, release: 1.2, modDecay: 0.12, modSustain: 0.02, tremoloRate: 1.5, tremoloDepth: 0.03, chorusWet: 0.12, cutoffMax: 5000, filterDefault: 0.62, trimDb: 1 },
  celeste: { engine: 'fm', harmonicity: 4, modIndex: 1.2, modWave: 'triangle', attack: 0.002, decay: 1.2, sustain: 0.03, release: 1.4, modDecay: 0.2, modSustain: 0.02, tremoloRate: 3, tremoloDepth: 0.06, chorusWet: 0.35, cutoffMax: 9000, filterDefault: 0.75, trimDb: 0 },
  musicbox: { engine: 'fm', harmonicity: 7, modIndex: 2.4, modWave: 'sine', attack: 0.002, decay: 1.6, sustain: 0.02, release: 1.8, modDecay: 0.25, modSustain: 0, tremoloRate: 2, tremoloDepth: 0.05, chorusWet: 0.25, cutoffMax: 12000, filterDefault: 0.85, trimDb: 2.5 },
  // ---- subtractive engine (long releases: notes ring out instead of stopping dead)
  felt: { engine: 'sub', subWave: 'triangle', attack: 0.004, decay: 1.9, sustain: 0.04, release: 1.5, envBaseHz: 260, envOctaves: 2.6, envDecay: 0.35, envSustain: 0.12, subQ: 1, tremoloRate: 1, tremoloDepth: 0.02, chorusWet: 0.12, cutoffMax: 3200, filterDefault: 0.6, trimDb: -3.5 },
  organ: { engine: 'sub', subWave: 'fattriangle', attack: 0.015, decay: 0.4, sustain: 0.9, release: 0.9, envBaseHz: 1600, envOctaves: 0.3, envDecay: 0.5, envSustain: 1, subQ: 0.7, tremoloRate: 6.4, tremoloDepth: 0.35, chorusWet: 0.5, cutoffMax: 6000, filterDefault: 0.7, trimDb: -7 },
  dusty: { engine: 'sub', subWave: 'sawtooth', attack: 0.003, decay: 1.9, sustain: 0.05, release: 1.4, envBaseHz: 200, envOctaves: 3, envDecay: 0.3, envSustain: 0.14, subQ: 2, tremoloRate: 2.5, tremoloDepth: 0.08, chorusWet: 0.3, cutoffMax: 2600, filterDefault: 0.6, trimDb: -1 },
  juno: { engine: 'sub', subWave: 'fatsawtooth', attack: 0.02, decay: 2.2, sustain: 0.5, release: 2.2, envBaseHz: 380, envOctaves: 2.6, envDecay: 0.7, envSustain: 0.35, subQ: 3, tremoloRate: 0.8, tremoloDepth: 0.05, chorusWet: 0.75, cutoffMax: 6000, filterDefault: 0.65, trimDb: -4 },
  clav: { engine: 'sub', subWave: 'square', attack: 0.001, decay: 0.5, sustain: 0.03, release: 0.6, envBaseHz: 500, envOctaves: 4, envDecay: 0.12, envSustain: 0.08, subQ: 6, tremoloRate: 4, tremoloDepth: 0.02, chorusWet: 0.12, cutoffMax: 9000, filterDefault: 0.8, trimDb: -4 },
  guitar: { engine: 'sub', subWave: 'fatsawtooth', attack: 0.002, decay: 1, sustain: 0.03, release: 0.9, envBaseHz: 320, envOctaves: 3.5, envDecay: 0.2, envSustain: 0.08, subQ: 1.5, tremoloRate: 3, tremoloDepth: 0.04, chorusWet: 0.25, cutoffMax: 4500, filterDefault: 0.7, trimDb: 7 },
};

export const PAD_PATCHES: Record<PadPatchId, Patch<PadPreset>> = {
  warm: { wave: 'triangle', spread: 18, attack: 1.6, cutoffMax: 4000, chorusWet: 0.5 },
  strings: { wave: 'sawtooth', spread: 24, attack: 1.2, cutoffMax: 2600, filterDefault: 0.5, chorusWet: 0.6, trimDb: -4 },
  glass: { wave: 'sine', spread: 10, attack: 2.2, cutoffMax: 8000, filterDefault: 0.7, chorusWet: 0.7, trimDb: 2 },
  hollow: { wave: 'square', spread: 14, attack: 1.4, cutoffMax: 2000, filterDefault: 0.45, chorusWet: 0.4, trimDb: -6 },
  choir: { wave: 'sine', spread: 30, attack: 2.4, cutoffMax: 2400, filterDefault: 0.5, lfoDepthCents: 300, chorusWet: 0.8, trimDb: 1 },
  tape: { wave: 'sawtooth', spread: 40, attack: 0.9, cutoffMax: 3000, filterDefault: 0.45, lfoDepthCents: 900, chorusWet: 0.55, trimDb: -5 },
};

export const BASS_PATCHES: Record<BassPatchId, Patch<BassPreset>> = {
  round: { wave: 'sine', drive: 2.2, attack: 0.008, decay: 0.5, sustain: 0.7, release: 0.2, filterDefault: 0.45, q: 0.8 },
  upright: { wave: 'triangle', drive: 1.4, attack: 0.004, decay: 0.35, sustain: 0.15, release: 0.12, filterDefault: 0.55, q: 1.2, trimDb: 2 },
  muted: { wave: 'sawtooth', drive: 1.2, attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.08, filterDefault: 0.22, q: 1.5, trimDb: -2 },
  square: { wave: 'square', drive: 1.1, attack: 0.006, decay: 0.5, sustain: 0.6, release: 0.15, filterDefault: 0.3, q: 1, trimDb: -5 },
  synth: { wave: 'sawtooth', drive: 1.6, attack: 0.004, decay: 0.4, sustain: 0.45, release: 0.1, filterDefault: 0.28, q: 4, trimDb: -4 },
  fingered: { wave: 'triangle', drive: 2.6, attack: 0.006, decay: 0.6, sustain: 0.5, release: 0.15, filterDefault: 0.6, q: 1 },
};

export const LEAD_PATCHES: Record<LeadPatchId, Patch<MelodyPreset>> = {
  flute: { bell: 0.1, softWave: 'sine', attack: 0.06, release: 0.8, vibratoRate: 5, vibratoDepth: 0.14, filterDefault: 0.55 },
  kalimba: { bell: 1, bellHarmonicity: 3.5, bellModIndex: 2.2, bellDecay: 0.5, release: 0.6, vibratoDepth: 0, filterDefault: 0.7 },
  vibes: { bell: 0.9, bellHarmonicity: 4, bellModIndex: 1.4, bellDecay: 1.6, release: 1.4, vibratoRate: 5.5, vibratoDepth: 0.1, filterDefault: 0.65 },
  trumpet: { bell: 0, softWave: 'sawtooth', attack: 0.05, release: 0.3, vibratoRate: 5.2, vibratoDepth: 0.12, filterDefault: 0.32, trimDb: -5 },
  whistle: { bell: 0, softWave: 'sine', attack: 0.03, release: 0.4, vibratoRate: 6, vibratoDepth: 0.25, filterDefault: 0.85, trimDb: -2 },
  guitar: { bell: 0.85, bellHarmonicity: 1, bellModIndex: 3, bellDecay: 0.45, release: 0.4, vibratoRate: 4.5, vibratoDepth: 0.04, filterDefault: 0.45 },
  sax: { bell: 0, softWave: 'sawtooth', attack: 0.07, release: 0.35, vibratoRate: 4.8, vibratoDepth: 0.18, filterDefault: 0.38, trimDb: -6 },
  nylon: { bell: 0.8, bellHarmonicity: 2, bellModIndex: 1.4, bellDecay: 0.7, release: 0.6, vibratoRate: 4, vibratoDepth: 0.02, filterDefault: 0.5, trimDb: 1 },
  pluck: { bell: 0.6, bellHarmonicity: 1, bellModIndex: 5, bellDecay: 0.25, softWave: 'triangle', release: 0.3, vibratoDepth: 0, filterDefault: 0.5, trimDb: -2 },
  synth: { bell: 0.2, softWave: 'square', attack: 0.02, release: 0.5, vibratoRate: 5, vibratoDepth: 0.1, filterDefault: 0.4, trimDb: -7 },
};

/**
 * Drum kits: each one is a different instrument, not a small variation (kick weight and sweep, snare colour and
 * length, hat brightness, saturation and tone all change).
 */
export const KITS: Record<KitId, Patch<DrumPreset>> = {
  // warm, round boom-bap
  dusty: {
    kickHz: 52, kickDecay: 0.42, kickPitchOct: 3.2, kickPitchDecay: 0.045, kickClickDb: -70, kickDb: -4,
    snareNoise: 'pink', snareHz: 1900, snareQ: 1.2, snareDecay: 0.17, snareAttack: 0.002, snareToneHz: 185, snareBodyDb: -4, snareDb: -12,
    hatHpHz: 6500, hatDecay: 0.045, hatDb: -22, ceilingHz: 6500, drive: 1.8,
  },
  // sampler pushed into the red: thick, gritty, dark
  crunchy: {
    kickHz: 58, kickDecay: 0.3, kickPitchOct: 2.5, kickPitchDecay: 0.03, kickClickDb: -18, kickDb: -3,
    snareNoise: 'white', snareHz: 1400, snareQ: 2.5, snareDecay: 0.22, snareAttack: 0.001, snareToneHz: 220, snareBodyDb: 0, snareDb: -9,
    hatHpHz: 4200, hatDecay: 0.09, hatDb: -16, ceilingHz: 3200, drive: 6, trimDb: 0,
  },
  // short, clicky, bright and dry
  tight: {
    kickHz: 50, kickDecay: 0.22, kickPitchOct: 4, kickPitchDecay: 0.02, kickClickDb: -12, kickDb: -3,
    snareNoise: 'white', snareHz: 3200, snareQ: 0.8, snareDecay: 0.09, snareAttack: 0.001, snareToneHz: 240, snareBodyDb: -8, snareDb: -10,
    hatHpHz: 9500, hatDecay: 0.018, hatDb: -17, ceilingHz: 12000, drive: 1.3,
  },
  // long booming sub kick, snappy snare, crisp hats
  eight08: {
    kickHz: 41, kickDecay: 1.2, kickPitchOct: 5.5, kickPitchDecay: 0.08, kickClickDb: -22, kickDb: -1,
    snareNoise: 'white', snareHz: 2600, snareQ: 1, snareDecay: 0.14, snareAttack: 0.001, snareToneHz: 200, snareBodyDb: -2, snareDb: -11,
    clapDb: -8, hatHpHz: 8500, hatDecay: 0.035, hatDb: -17, ceilingHz: 10000, drive: 2.2,
  },
  // feathered kick, swishing brushes
  brushes: {
    kickHz: 60, kickDecay: 0.25, kickPitchOct: 1.5, kickPitchDecay: 0.03, kickClickDb: -70, kickDb: -11,
    snareNoise: 'pink', snareHz: 3000, snareQ: 0.6, snareDecay: 0.45, snareAttack: 0.03, snareToneHz: 200, snareBodyDb: -30, snareDb: -13,
    hatHpHz: 5000, hatDecay: 0.08, hatDb: -28, rideDb: -21, ceilingHz: 5500, drive: 1.1,
  },
  // tuned-up jazz kit: ringing snare, ride
  jazz: {
    kickHz: 64, kickDecay: 0.28, kickPitchOct: 2, kickPitchDecay: 0.03, kickClickDb: -30, kickDb: -8,
    snareNoise: 'white', snareHz: 3400, snareQ: 3, snareDecay: 0.2, snareAttack: 0.001, snareToneHz: 300, snareBodyDb: -1, snareDb: -12,
    hatHpHz: 7500, hatDecay: 0.04, hatDb: -23, rideDb: -19, ceilingHz: 9000, drive: 1.2,
  },
  // pillows: muffled, low, gentle
  soft: {
    kickHz: 55, kickDecay: 0.5, kickPitchOct: 2.5, kickPitchDecay: 0.05, kickClickDb: -70, kickDb: -6,
    snareNoise: 'brown', snareHz: 1200, snareQ: 0.7, snareDecay: 0.25, snareAttack: 0.004, snareToneHz: 170, snareBodyDb: -6, snareDb: -13,
    rimDb: -13, hatHpHz: 3500, hatDecay: 0.08, hatDb: -30, shakerDb: -22, ceilingHz: 3000, drive: 1.1,
  },
  // a break sampled off an old tape: boxy, dark, saturated
  tape: {
    kickHz: 62, kickDecay: 0.35, kickPitchOct: 2.8, kickPitchDecay: 0.035, kickClickDb: -26, kickDb: -3,
    snareNoise: 'pink', snareHz: 1700, snareQ: 1.6, snareDecay: 0.2, snareAttack: 0.002, snareToneHz: 170, snareBodyDb: -2, snareDb: -10,
    hatHpHz: 3000, hatDecay: 0.11, hatDb: -18, ceilingHz: 2400, drive: 3.5, trimDb: 2,
  },
};

/** Station preset with a patch on top. */
export function withPatch<T extends { levelDb: number }>(base: T, patch: Patch<T> | undefined): T {
  if (!patch) return base;
  const { trimDb, ...rest } = patch;
  return { ...base, ...(rest as Partial<T>), levelDb: base.levelDb + (trimDb ?? 0) };
}
