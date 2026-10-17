/**
 * Pure music theory helpers: scales, jazz chord qualities, voicings with voice leading. No Tone / DOM.
 */
import type { ChordSpec, KeySpec, ScaleName } from '@shared/index';

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (Number.isFinite(x) ? clamp(x, 0, 1) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mod12 = (n: number): number => ((n % 12) + 12) % 12;

/** Flat spellings read better for the jazzy keys lofi lives in. */
export const PC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const SCALES: Record<ScaleName, readonly number[]> = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export const isMinorScale = (s: ScaleName): boolean => s === 'dorian' || s === 'aeolian';

export function keyLabel(key: KeySpec): string {
  const name = PC_NAMES[mod12(key.tonic)];
  return `${name} ${key.scale === 'ionian' ? 'major' : key.scale === 'aeolian' ? 'minor' : key.scale}`;
}

/** Notes a melody may use: pentatonic core plus one colour tone (no avoid-notes against typical lofi chords). */
export function melodyScale(key: KeySpec): number[] {
  switch (key.scale) {
    case 'dorian':
    case 'aeolian':
      return [0, 2, 3, 5, 7, 10];
    case 'mixolydian':
      return [0, 2, 4, 7, 9, 10];
    default:
      return [0, 2, 4, 7, 9, 11];
  }
}

// ---------------------------------------------------------------------------------------------
// chords
// ---------------------------------------------------------------------------------------------

export type ChordQuality =
  | 'maj7' | 'maj9' | '6/9'
  | 'm7' | 'm9' | 'm11'
  | '7' | '9' | '13' | '7b9' | '9sus'
  | 'm7b5';

export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  '6/9': [0, 4, 7, 9, 14],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  '13': [0, 4, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '9sus': [0, 5, 7, 10, 14],
  m7b5: [0, 3, 6, 10],
};

/** Simpler / richer versions of each quality, used by the "jazz" (complexity) control. */
const SIMPLER: Partial<Record<ChordQuality, ChordQuality>> = {
  maj9: 'maj7', '6/9': 'maj7', m9: 'm7', m11: 'm9', '9': '7', '13': '9', '7b9': '7',
};
const RICHER: Partial<Record<ChordQuality, ChordQuality>> = {
  maj7: 'maj9', m7: 'm9', m9: 'm11', '7': '9', '9': '13',
};

/** Shift a quality toward plainer (complexity < 0.35) or lusher (> 0.7) harmony. */
export function colourQuality(q: ChordQuality, complexity: number): ChordQuality {
  if (complexity < 0.35) {
    let out = q;
    // very low complexity strips two levels (m11 -> m9 -> m7)
    for (let i = 0; i < (complexity < 0.15 ? 2 : 1); i++) out = SIMPLER[out] ?? out;
    return out;
  }
  if (complexity > 0.7) return RICHER[q] ?? q;
  return q;
}

export interface Chord {
  /** pitch class of the root */
  rootPc: number;
  quality: ChordQuality;
  /** length in bars */
  bars: number;
}

export function chordLabel(c: Pick<Chord, 'rootPc' | 'quality'>): string {
  const suffix = c.quality === '7' ? '7' : c.quality;
  return `${PC_NAMES[mod12(c.rootPc)]}${suffix}`;
}

/** Bass-register MIDI root (E1..Eb2 region: 28..39 is too low for small speakers, so use 33..44). */
export function bassRoot(rootPc: number): number {
  const pc = mod12(rootPc);
  return pc >= 9 ? 24 + pc : 36 + pc;
}

export function toChordSpec(c: Chord): ChordSpec {
  return { root: bassRoot(c.rootPc), label: chordLabel(c), intervals: [...QUALITY_INTERVALS[c.quality]] };
}

/** Pitch classes of the chord (absolute), root first. */
export function chordPcs(c: Pick<Chord, 'rootPc' | 'quality'>): number[] {
  const out: number[] = [];
  for (const iv of QUALITY_INTERVALS[c.quality]) {
    const pc = mod12(c.rootPc + iv);
    if (!out.includes(pc)) out.push(pc);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// voicings
// ---------------------------------------------------------------------------------------------

export interface VoicingOptions {
  lo: number;
  hi: number;
  /** drop the root (the bass has it) when the chord has at least 4 tones */
  rootless: boolean;
  /** maximum number of voices */
  maxVoices: number;
}

/** All close-position voicings of `pcs` that fit in [lo, hi]. */
function candidates(pcs: number[], lo: number, hi: number): number[][] {
  const out: number[][] = [];
  const n = pcs.length;
  for (let r = 0; r < n; r++) {
    const order = [...pcs.slice(r), ...pcs.slice(0, r)];
    for (let base = lo - 12; base <= hi; base += 12) {
      const v: number[] = [];
      let last = -Infinity;
      for (const pc of order) {
        let m = base + mod12(pc - base);
        while (m <= last) m += 12;
        v.push(m);
        last = m;
      }
      if (v[0]! >= lo && v[v.length - 1]! <= hi) out.push(v);
    }
  }
  return out;
}

/** Which tones to keep: prefer guide tones (3rd, 7th) and colour (9th, 11th, 13th), drop the 5th first. */
function selectTones(c: Pick<Chord, 'rootPc' | 'quality'>, opts: VoicingOptions): number[] {
  const ivs = QUALITY_INTERVALS[c.quality];
  let tones = ivs.map((iv) => ({ iv, pc: mod12(c.rootPc + iv) }));
  if (opts.rootless && tones.length >= 4) tones = tones.filter((t) => t.iv !== 0);
  // drop perfect 5th, then root, while there are too many voices
  const dropOrder = [7, 0, 6];
  for (const d of dropOrder) {
    if (tones.length <= opts.maxVoices) break;
    const i = tones.findIndex((t) => t.iv === d);
    if (i >= 0 && tones.length > 3) tones.splice(i, 1);
  }
  while (tones.length > opts.maxVoices) tones.pop();
  const pcs: number[] = [];
  for (const t of tones) if (!pcs.includes(t.pc)) pcs.push(t.pc);
  return pcs;
}

/** Cost of moving from `prev` to `next` (each new note pays the distance to the nearest old note). */
export function voiceLeadingCost(prev: readonly number[], next: readonly number[]): number {
  let cost = 0;
  for (const n of next) {
    let best = Infinity;
    for (const p of prev) best = Math.min(best, Math.abs(n - p));
    cost += best;
  }
  return cost;
}

/**
 * Voice a chord in close position inside [lo, hi], choosing the inversion closest to `prev`
 * (smooth voice leading) or nearest the middle of the range when there is no previous voicing.
 * Deterministic. Returns ascending MIDI notes.
 */
export function voiceChord(c: Pick<Chord, 'rootPc' | 'quality'>, prev: readonly number[] | null, opts: VoicingOptions): number[] {
  const pcs = selectTones(c, opts);
  const cands = candidates(pcs, opts.lo, opts.hi);
  if (cands.length === 0) {
    // range too narrow: fall back to stacking upward from lo
    return candidates(pcs, opts.lo, opts.hi + 12)[0] ?? pcs.map((pc) => opts.lo + mod12(pc - opts.lo));
  }
  const mid = (opts.lo + opts.hi) / 2;
  let best = cands[0]!;
  let bestCost = Infinity;
  for (const v of cands) {
    const centre = v.reduce((a, b) => a + b, 0) / v.length;
    let cost = prev && prev.length ? voiceLeadingCost(prev, v) : 0;
    cost += Math.abs(centre - mid) * (prev ? 0.15 : 1);
    // a minor second between the two lowest voices sounds muddy on an e-piano
    if (v.length > 1 && v[1]! - v[0]! === 1) cost += 4;
    if (cost < bestCost - 1e-9) {
      best = v;
      bestCost = cost;
    }
  }
  return best;
}

/** Nearest MIDI note with a pitch class in `pcs` (ties resolve downward). */
export function nearestInSet(midi: number, pcs: readonly number[]): number {
  for (let d = 0; d < 12; d++) {
    if (pcs.includes(mod12(midi - d))) return midi - d;
    if (pcs.includes(mod12(midi + d))) return midi + d;
  }
  return midi;
}
