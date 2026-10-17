/**
 * Mood ("station") definitions: harmony pools, tempo, groove vocabulary and arrangement flavour.
 * Harmony is fixed per song when the song is planned; groove styling follows the live mood every bar.
 */
import type { MoodId, ScaleName } from '@shared/index';
import type { ChordQuality } from './theory';

/** [semitones above the tonic, quality] */
export type ProgStep = readonly [number, ChordQuality];
export type ProgTemplate = readonly ProgStep[];

export type DrumStyle = 'boombap' | 'soft' | 'whisper';
export type HatStyle = 'eighths' | 'sixteenths' | 'shaker';
/** Keys comping vocabulary, see layers/keys.ts */
export type CompStyle = 'whole' | 'charleston' | 'push' | 'halves' | 'rolled' | 'lazy';
/** Bass vocabulary, see layers/bass.ts */
export type BassStyle = 'held' | 'pulse' | 'walkup' | 'dub';

export interface MoodConfig {
  id: MoodId;
  name: string;
  blurb: string;
  tempo: readonly [number, number];
  scales: readonly ScaleName[];
  progressions: readonly ProgTemplate[];
  /** weighted choice of bars per chord */
  chordBars: ReadonlyArray<readonly [number, number]>;
  drums: DrumStyle;
  hats: readonly HatStyle[];
  comps: readonly CompStyle[];
  basses: readonly BassStyle[];
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
];

// major-key progressions, tonic = I
const MAJOR: ProgTemplate[] = [
  [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, '13']],
  [[5, 'maj9'], [4, 'm7'], [2, 'm9'], [0, 'maj9']],
  [[0, 'maj7'], [0, '9'], [5, 'maj7'], [5, 'm7']],
  [[2, 'm9'], [7, '13'], [0, 'maj9'], [9, '7b9']],
  [[5, 'maj9'], [7, '9sus'], [4, 'm7'], [9, 'm9']],
  [[0, '6/9'], [4, '7b9'], [9, 'm9'], [7, '9sus']],
];

// slow, floating progressions for the ambient station
const AMBIENT: ProgTemplate[] = [
  [[0, 'maj9'], [5, 'maj9']],
  [[0, 'm9'], [8, 'maj9']],
  [[0, 'maj9'], [9, 'm9'], [5, 'maj9'], [7, '9sus']],
  [[0, 'm11'], [3, 'maj9']],
  [[0, '6/9'], [2, 'm9'], [5, 'maj9'], [0, '6/9']],
];

export const MOODS: Record<MoodId, MoodConfig> = {
  study: {
    id: 'study',
    name: 'Late Night Study',
    blurb: 'dusty boom-bap, minor ninths',
    tempo: [74, 86],
    scales: ['dorian', 'aeolian'],
    progressions: MINOR,
    chordBars: [[1, 4], [2, 1]],
    drums: 'boombap',
    hats: ['eighths', 'sixteenths'],
    comps: ['charleston', 'push', 'whole', 'lazy'],
    basses: ['pulse', 'walkup', 'dub'],
    melodyDensity: 0.55,
    padInGroove: 0.25,
    ambient: false,
  },
  rainy: {
    id: 'rainy',
    name: 'Rainy Window',
    blurb: 'slow, soft drums, rolled chords',
    tempo: [64, 76],
    scales: ['dorian', 'aeolian'],
    progressions: [...MINOR, AMBIENT[1]!, AMBIENT[3]!],
    chordBars: [[1, 2], [2, 2]],
    drums: 'soft',
    hats: ['shaker', 'eighths'],
    comps: ['rolled', 'whole', 'halves', 'lazy'],
    basses: ['held', 'dub'],
    melodyDensity: 0.4,
    padInGroove: 0.6,
    ambient: false,
  },
  sunday: {
    id: 'sunday',
    name: 'Sunday Morning',
    blurb: 'warm major sevenths, light swing',
    tempo: [80, 92],
    scales: ['ionian', 'lydian', 'mixolydian'],
    progressions: MAJOR,
    chordBars: [[1, 1]],
    drums: 'boombap',
    hats: ['eighths', 'shaker'],
    comps: ['charleston', 'push', 'halves', 'rolled'],
    basses: ['pulse', 'walkup'],
    melodyDensity: 0.6,
    padInGroove: 0.2,
    ambient: false,
  },
  drift: {
    id: 'drift',
    name: 'Ambient Drift',
    blurb: 'beatless haze, long chords',
    tempo: [58, 70],
    scales: ['lydian', 'ionian', 'dorian'],
    progressions: AMBIENT,
    chordBars: [[2, 2], [4, 1]],
    drums: 'whisper',
    hats: ['shaker'],
    comps: ['whole', 'rolled'],
    basses: ['held'],
    melodyDensity: 0.3,
    padInGroove: 1,
    ambient: true,
  },
};
