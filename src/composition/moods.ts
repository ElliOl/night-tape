/**
 * Station ("mood") definitions: harmony pools, tempo, groove vocabulary and the weighted sound choices each song
 * draws from. Harmony and sounds are fixed per song when the song is planned; how hard it is played follows the
 * live controls every bar.
 */
import type { BassPatchId, KeysPatchId, KitId, LeadPatchId, MoodId, PadPatchId, ScaleName } from '@shared/index';
import type { ChordQuality, VoicingStyle } from './theory';

/** [semitones above the tonic, quality] */
export type ProgStep = readonly [number, ChordQuality];
export type ProgTemplate = readonly ProgStep[];
export type Weights<T extends string> = ReadonlyArray<readonly [T, number]>;

/** Drum groove families, see layers/drums.ts */
export type DrumFamily = 'boombap' | 'halftime' | 'dilla' | 'brushes' | 'bossa' | 'twostep' | 'sparse' | 'whisper' | 'chopbreak';
export type HatStyle = 'eighths' | 'sixteenths' | 'shaker' | 'offbeat' | 'ride';
/** Keys comping vocabulary, see layers/keys.ts */
export type CompStyle = 'whole' | 'charleston' | 'push' | 'halves' | 'rolled' | 'lazy' | 'arp' | 'stabs' | 'bossa' | 'pulse' | 'chops';
/** Bass vocabulary, see layers/bass.ts */
export type BassStyle = 'held' | 'pulse' | 'walkup' | 'dub' | 'walking' | 'octaves' | 'syncopated';
export type Soloist = 'lead' | 'keys';

export const DRUM_FAMILY_LABEL: Record<DrumFamily, string> = {
  boombap: 'boom-bap',
  halftime: 'half-time',
  dilla: 'drunk swing',
  brushes: 'brushes',
  bossa: 'bossa',
  twostep: 'two-step',
  sparse: 'sparse',
  whisper: 'whisper',
  chopbreak: 'chopped break',
};

export interface MoodConfig {
  id: MoodId;
  name: string;
  blurb: string;
  tempo: readonly [number, number];
  scales: readonly ScaleName[];
  progressions: readonly ProgTemplate[];
  bridges: readonly ProgTemplate[];
  /** weighted choice of bars per chord */
  chordBars: ReadonlyArray<readonly [number, number]>;
  drumFamilies: Weights<DrumFamily>;
  comps: readonly CompStyle[];
  basses: readonly BassStyle[];
  voicings: Weights<VoicingStyle>;
  keysPatches: Weights<KeysPatchId>;
  padPatches: Weights<PadPatchId>;
  bassPatches: Weights<BassPatchId>;
  leadPatches: Weights<LeadPatchId>;
  kits: Weights<KitId>;
  soloists: Weights<Soloist>;
  /** 0..1 base melody density */
  melodyDensity: number;
  /** probability that a groove section also carries the pad */
  padInGroove: number;
  /** ambient arrangement (long sections, drums rarely) */
  ambient: boolean;
}

// minor-key (dorian / aeolian) progressions, tonic = i
const MINOR: ProgTemplate[] = [
  [[0, 'm9'], [5, 'm9'], [10, '9'], [3, 'maj7']],
  [[0, 'm9'], [8, 'maj7'], [10, '13'], [0, 'm9']],
  [[2, 'm7b5'], [7, '7b9'], [0, 'm9'], [0, 'm9']],
  [[5, 'm9'], [7, 'm7'], [0, 'm9'], [8, 'maj7']],
  [[0, 'm11'], [5, '9'], [0, 'm11'], [5, '9']],
  [[8, 'maj9'], [7, '7b9'], [0, 'm9'], [10, '9sus']],
  [[0, 'm9'], [3, 'maj7'], [5, 'm9'], [7, '7b9']],
  [[3, 'maj9'], [2, 'm7b5'], [7, '7b9'], [0, 'm9']],
  [[0, 'm9'], [10, '7sus'], [8, 'maj7'], [7, '7#9']],
  [[5, 'm9'], [10, '13'], [3, 'maj9'], [8, 'maj7']],
  [[0, 'm7'], [0, 'm7'], [8, 'maj9'], [7, '7b9']],
  [[0, 'm9'], [1, 'maj7'], [0, 'm9'], [1, 'maj7']],
  // minor ii-V at the end of the loop instead of the start
  [[0, 'm9'], [0, 'm9'], [2, 'm7b5'], [7, '7#9']],
  // "just the two of us" descent, minor-key flavour: bVI - V7#9 - i - bVII
  [[8, 'maj7'], [7, '7#9'], [0, 'm7'], [10, '9']],
  // i - iv vamp (two chords, lots of room)
  [[0, 'm9'], [5, 'm9']],
  [[0, 'm11'], [10, '6/9']],
  // bVI - bII (Neapolitan) colour before the dominant
  [[0, 'm9'], [8, 'maj7'], [1, 'maj7'], [7, '7#9']],
  // dorian IV13 answer
  [[0, 'm9'], [5, '13'], [0, 'm9'], [7, '7#9']],
  // start on the relative major and fall home
  [[3, 'maj9'], [5, 'm9'], [0, 'm9'], [0, 'm11']],
  // neo-soul chromatic slide down to the turnaround
  [[5, 'm9'], [4, '7#9'], [3, 'maj9'], [2, 'm7b5'], [1, 'maj7'], [7, '7b9'], [0, 'm9'], [0, 'm9']],
  [[0, 'm9'], [10, '13'], [8, 'maj9'], [7, '7b9'], [5, 'm9'], [3, 'maj7'], [2, 'm7b5'], [7, '7#9']],
];

// major-key progressions, tonic = I
const MAJOR: ProgTemplate[] = [
  [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, '13']],
  [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [0, 'maj9']],
  [[0, 'maj7'], [0, '9'], [5, 'maj7'], [5, 'm7']],
  [[2, 'm9'], [7, '13'], [0, 'maj9'], [9, '7b9']],
  [[5, 'maj9'], [7, '9sus'], [4, 'm7'], [9, 'm9']],
  [[0, '6/9'], [4, '7b9'], [9, 'm9'], [7, '9sus']],
  [[0, 'maj7'], [4, 'm7'], [9, 'm9'], [7, '9sus']],
  [[0, 'maj9'], [10, '9'], [5, 'maj7'], [5, 'm7']],
  [[2, 'm9'], [1, '7'], [0, 'maj9'], [0, 'maj9']],
  [[5, 'maj7'], [7, '7sus'], [4, 'm7'], [9, 'm7'], [2, 'm9'], [7, '13'], [0, 'maj9'], [0, 'maj9']],
  // I - VI7 - ii - V turnaround
  [[0, 'maj9'], [9, '7b9'], [2, 'm9'], [7, '13']],
  // "just the two of us": IVmaj7 - III7 - vi - I7 (back to IV)
  [[5, 'maj7'], [4, '7#9'], [9, 'm9'], [0, '9']],
  // borrowed minor iv
  [[0, 'maj9'], [2, 'm9'], [5, 'm9'], [0, '6/9']],
  // backdoor: IV - bVII9 - I
  [[5, 'maj9'], [10, '9'], [0, 'maj9'], [0, '6/9']],
  // stepwise climb
  [[0, 'maj7'], [2, 'm7'], [4, 'm7'], [5, 'maj7']],
  // vi - IV - I - Vsus
  [[9, 'm9'], [5, 'maj9'], [0, 'maj9'], [7, '9sus']],
  // chromatic tritone-sub walk down to ii, then home
  [[0, 'maj9'], [4, 'm7'], [3, '7'], [2, 'm9'], [1, '9'], [0, 'maj9'], [9, 'm9'], [7, '13']],
  // two-chord vamps
  [[0, 'maj9'], [2, 'm9']],
  [[5, 'maj9'], [0, '6/9']],
];

// slow, floating progressions for the ambient station
const AMBIENT: ProgTemplate[] = [
  [[0, 'maj9'], [5, 'maj9']],
  [[0, 'm9'], [8, 'maj9']],
  [[0, 'maj9'], [9, 'm9'], [5, 'maj9'], [7, '9sus']],
  [[0, 'm11'], [3, 'maj9']],
  [[0, '6/9'], [2, 'm9'], [5, 'maj9'], [0, '6/9']],
  [[0, 'maj9#11'], [7, '9sus']],
  [[0, 'm9'], [5, 'm9'], [8, 'maj9'], [3, 'maj9']],
  [[0, 'maj9#11'], [2, '9']],
  [[0, 'm9'], [2, 'm9']],
  [[5, 'maj9'], [0, '6/9']],
  [[0, 'maj9'], [4, 'm7'], [9, 'm9'], [5, 'maj9#11']],
];

// bridges: somewhere else for a while, the last chord leads home
const MINOR_BRIDGES: ProgTemplate[] = [
  [[8, 'maj9'], [10, '9'], [3, 'maj7'], [7, '7b9']],
  [[5, 'm9'], [10, '13'], [3, 'maj9'], [2, 'm7b5']],
  [[3, 'maj9'], [8, 'maj7'], [5, 'm9'], [7, '7#9']],
  [[1, 'maj7'], [8, 'maj7'], [10, '9sus'], [7, '7b9']],
  [[10, 'maj9'], [8, 'maj9'], [5, 'm9'], [7, '7#9']],
  [[5, '13'], [5, 'm9'], [10, '9sus'], [7, '7b9']],
];
const MAJOR_BRIDGES: ProgTemplate[] = [
  [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [7, '9sus']],
  [[9, 'm9'], [2, '9'], [5, 'maj7'], [7, '13']],
  [[8, 'maj7'], [10, '9'], [0, 'maj9'], [7, '7sus']],
  [[4, 'm7'], [9, '7b9'], [2, 'm9'], [7, '13']],
  [[5, 'm9'], [10, '13'], [0, 'maj9'], [7, '7sus']],
  [[3, 'maj7'], [8, 'maj7'], [2, 'm9'], [7, '13']],
];
const AMBIENT_BRIDGES: ProgTemplate[] = [
  [[5, 'maj9'], [7, '9sus']],
  [[8, 'maj9'], [10, '9sus']],
  [[3, 'maj9'], [5, 'm9']],
  [[2, '9'], [7, '9sus']],
];

export const MOODS: Record<MoodId, MoodConfig> = {
  study: {
    id: 'study',
    name: 'Late Night Study',
    blurb: 'dusty boom-bap, minor ninths',
    tempo: [72, 90],
    scales: ['dorian', 'aeolian'],
    progressions: MINOR,
    bridges: [...MINOR_BRIDGES, ...MAJOR_BRIDGES.slice(0, 1)],
    chordBars: [[1, 4], [2, 1]],
    drumFamilies: [['boombap', 4], ['dilla', 2], ['halftime', 2], ['chopbreak', 2], ['twostep', 1]],
    comps: ['charleston', 'push', 'whole', 'lazy', 'stabs', 'arp', 'chops'],
    basses: ['pulse', 'walkup', 'dub', 'syncopated', 'octaves'],
    voicings: [['close', 3], ['spread', 2], ['shell', 1], ['quartal', 1]],
    keysPatches: [['rhodes', 3], ['wurli', 2], ['dusty', 2], ['felt', 2], ['piano', 2], ['juno', 2], ['guitar', 2], ['clav', 1], ['musicbox', 1]],
    padPatches: [['warm', 2], ['tape', 2], ['strings', 1], ['hollow', 1], ['choir', 1]],
    bassPatches: [['round', 2], ['upright', 2], ['fingered', 2], ['muted', 1], ['synth', 1]],
    leadPatches: [['kalimba', 2], ['flute', 2], ['trumpet', 2], ['guitar', 2], ['sax', 2], ['nylon', 1], ['vibes', 1]],
    kits: [['dusty', 3], ['crunchy', 3], ['tape', 3], ['eight08', 2], ['tight', 2], ['jazz', 1]],
    soloists: [['lead', 1], ['keys', 1]],
    melodyDensity: 0.55,
    padInGroove: 0.25,
    ambient: false,
  },
  rainy: {
    id: 'rainy',
    name: 'Rainy Window',
    blurb: 'slow, soft drums, rolled chords',
    tempo: [60, 78],
    scales: ['dorian', 'aeolian'],
    progressions: [...MINOR, AMBIENT[1]!, AMBIENT[3]!, AMBIENT[6]!],
    bridges: [...MINOR_BRIDGES, ...AMBIENT_BRIDGES],
    chordBars: [[1, 2], [2, 2]],
    drumFamilies: [['sparse', 3], ['halftime', 2], ['brushes', 2], ['boombap', 1]],
    comps: ['rolled', 'whole', 'halves', 'lazy', 'arp', 'chops'],
    basses: ['held', 'dub', 'walking'],
    voicings: [['spread', 2], ['close', 2], ['quartal', 2], ['cluster', 1]],
    keysPatches: [['felt', 3], ['rhodes', 2], ['dusty', 2], ['piano', 2], ['vibes', 2], ['guitar', 2], ['musicbox', 2], ['celeste', 1], ['juno', 1]],
    padPatches: [['strings', 2], ['glass', 2], ['tape', 2], ['choir', 1]],
    bassPatches: [['round', 3], ['upright', 2], ['muted', 1]],
    leadPatches: [['flute', 2], ['whistle', 2], ['guitar', 2], ['nylon', 2], ['sax', 1], ['vibes', 1]],
    kits: [['soft', 3], ['brushes', 2], ['tape', 2], ['dusty', 2], ['eight08', 1]],
    soloists: [['lead', 2], ['keys', 1]],
    melodyDensity: 0.4,
    padInGroove: 0.6,
    ambient: false,
  },
  sunday: {
    id: 'sunday',
    name: 'Sunday Morning',
    blurb: 'warm major sevenths, light swing',
    tempo: [78, 96],
    scales: ['ionian', 'lydian', 'mixolydian'],
    progressions: MAJOR,
    bridges: MAJOR_BRIDGES,
    chordBars: [[1, 1]],
    drumFamilies: [['boombap', 2], ['bossa', 2], ['brushes', 2], ['twostep', 2], ['chopbreak', 1], ['dilla', 1]],
    comps: ['charleston', 'push', 'halves', 'rolled', 'bossa', 'pulse', 'chops'],
    basses: ['pulse', 'walkup', 'walking', 'syncopated'],
    voicings: [['close', 2], ['spread', 2], ['shell', 2]],
    keysPatches: [['wurli', 3], ['rhodes', 2], ['piano', 2], ['organ', 2], ['clav', 2], ['guitar', 2], ['vibes', 1], ['juno', 1]],
    padPatches: [['warm', 2], ['hollow', 2], ['strings', 1]],
    bassPatches: [['fingered', 3], ['upright', 2], ['square', 1], ['synth', 1]],
    leadPatches: [['vibes', 2], ['trumpet', 2], ['guitar', 2], ['synth', 2], ['sax', 2], ['pluck', 1], ['nylon', 1], ['kalimba', 1]],
    kits: [['tight', 2], ['jazz', 2], ['dusty', 2], ['brushes', 1], ['eight08', 1], ['tape', 1]],
    soloists: [['keys', 2], ['lead', 1]],
    melodyDensity: 0.6,
    padInGroove: 0.2,
    ambient: false,
  },
  drift: {
    id: 'drift',
    name: 'Ambient Drift',
    blurb: 'beatless haze, long chords',
    tempo: [54, 72],
    scales: ['lydian', 'ionian', 'dorian'],
    progressions: AMBIENT,
    bridges: AMBIENT_BRIDGES,
    chordBars: [[2, 2], [4, 1]],
    drumFamilies: [['whisper', 3], ['brushes', 1], ['sparse', 1]],
    comps: ['whole', 'rolled', 'arp'],
    basses: ['held'],
    voicings: [['quartal', 2], ['spread', 2], ['cluster', 2], ['close', 1]],
    keysPatches: [['felt', 2], ['vibes', 2], ['musicbox', 2], ['juno', 2], ['celeste', 2], ['rhodes', 1], ['organ', 1]],
    padPatches: [['glass', 3], ['strings', 2], ['hollow', 2], ['choir', 2]],
    bassPatches: [['round', 3], ['muted', 1]],
    leadPatches: [['whistle', 2], ['kalimba', 2], ['flute', 2], ['pluck', 1], ['synth', 1]],
    kits: [['soft', 3], ['brushes', 2], ['tape', 1]],
    soloists: [['lead', 1]],
    melodyDensity: 0.3,
    padInGroove: 1,
    ambient: true,
  },
};
