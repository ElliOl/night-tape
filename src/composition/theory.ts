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
  | 'maj' | 'maj7' | 'maj9' | '6/9' | 'maj13' | 'maj9#11'
  | 'm' | 'm7' | 'm9' | 'm11'
  | '7' | '9' | '13' | '7b9' | '7#9' | '9sus' | '7sus'
  | 'm7b5';

export const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  '6/9': [0, 4, 7, 9, 14],
  maj13: [0, 4, 11, 14, 21],
  'maj9#11': [0, 4, 11, 14, 18],
  m: [0, 3, 7],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  '7': [0, 4, 7, 10],
  '9': [0, 4, 7, 10, 14],
  '13': [0, 4, 10, 14, 21],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 10, 15],
  '9sus': [0, 5, 7, 10, 14],
  '7sus': [0, 5, 7, 10],
  m7b5: [0, 3, 6, 10],
};

/** One step plainer / lusher for each quality (the "jazz" control walks these chains). */
const SIMPLER: Partial<Record<ChordQuality, ChordQuality>> = {
  maj13: 'maj9', 'maj9#11': 'maj9', maj9: 'maj7', '6/9': 'maj7', maj7: 'maj',
  m11: 'm9', m9: 'm7', m7: 'm',
  '13': '9', '9': '7', '7b9': '7', '7#9': '7', '9sus': '7sus',
};
const RICHER: Partial<Record<ChordQuality, ChordQuality>> = {
  maj: 'maj7', maj7: 'maj9', maj9: 'maj13', '6/9': 'maj9#11',
  m: 'm7', m7: 'm9', m9: 'm11',
  '7': '9', '9': '13', '7b9': '7#9', '7sus': '9sus',
};

/** Colour steps for a complexity value: 0 -> -2 (triads), 0.5 -> 0, 1 -> +2 (13ths). */
export function colourSteps(complexity: number): number {
  return Math.round((clamp01(complexity) - 0.5) * 4.4);
}

/** Walk a quality toward plainer (complexity < 0.5) or lusher (> 0.5) harmony. */
export function colourQuality(q: ChordQuality, complexity: number): ChordQuality {
  const steps = colourSteps(complexity);
  let out = q;
  for (let i = 0; i < Math.abs(steps); i++) out = (steps < 0 ? SIMPLER[out] : RICHER[out]) ?? out;
  return out;
}

export interface Chord {
  /** pitch class of the root */
  rootPc: number;
  quality: ChordQuality;
  /** length in bars */
  bars: number;
}

export function chordLabel(c: Pick<Chord, 'rootPc' | 'quality'>): string {
  const suffix = c.quality === 'maj' ? '' : c.quality;
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

/** How chords are shaped on the keys (chosen per song). */
export type VoicingStyle = 'close' | 'spread' | 'shell' | 'quartal' | 'cluster';

export interface VoicingOptions {
  lo: number;
  hi: number;
  /** default 'close' */
  style?: VoicingStyle;
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

/** Shapes (intervals above the root, may exceed an octave) for the open voicing styles. */
function shapeFor(c: Pick<Chord, 'quality'>, style: VoicingStyle): number[] | null {
  const ivs = QUALITY_INTERVALS[c.quality];
  const has = (iv: number): boolean => ivs.includes(iv);
  const third = has(3) ? 3 : has(4) ? 4 : 5;
  const seventh = has(10) ? 10 : has(11) ? 11 : has(9) ? 9 : 7;
  const colour = has(14) ? 14 : has(21) ? 21 : has(17) ? 17 : has(13) ? 13 : has(15) ? 15 : has(6) ? 6 : 7;
  switch (style) {
    case 'shell':
      // guide tones low, one colour tone on top
      return [third, seventh, colour + 12 > 26 ? colour : colour + 12].sort((a, b) => a - b);
    case 'quartal':
      // stacked fourths ("So What" style) built on the 3rd (major) or the root (minor / sus)
      if (c.quality === 'm7b5') return null;
      if (third === 4) return [4, 9, 14, 19];
      return [0, 5, 10, 15, 19];
    default:
      return null;
  }
}

function scoreVoicing(v: readonly number[], prev: readonly number[] | null, mid: number, allowClusters: boolean): number {
  const centre = v.reduce((a, b) => a + b, 0) / v.length;
  let cost = prev && prev.length ? voiceLeadingCost(prev, v) : 0;
  cost += Math.abs(centre - mid) * (prev ? 0.15 : 1);
  // a minor second between the two lowest voices sounds muddy on an e-piano
  if (!allowClusters && v.length > 1 && v[1]! - v[0]! === 1) cost += 4;
  return cost;
}

/**
 * Voice a chord inside [lo, hi] in the given style, choosing the placement closest to `prev`
 * (smooth voice leading) or nearest the middle of the range when there is no previous voicing.
 * Deterministic. Returns ascending MIDI notes.
 */
export function voiceChord(c: Pick<Chord, 'rootPc' | 'quality'>, prev: readonly number[] | null, opts: VoicingOptions): number[] {
  const style = opts.style ?? 'close';
  const mid = (opts.lo + opts.hi) / 2;
  let cands: number[][] = [];

  const shape = shapeFor(c, style);
  if (shape) {
    for (let base = opts.lo - 24; base <= opts.hi; base++) {
      if (mod12(base) !== mod12(c.rootPc)) continue;
      const v = shape.map((iv) => base + iv);
      if (v[0]! >= opts.lo && v[v.length - 1]! <= opts.hi + 2) cands.push(v);
    }
  } else {
    const pcs = selectTones(c, { ...opts, maxVoices: style === 'cluster' ? Math.max(opts.maxVoices, 5) : opts.maxVoices });
    cands = candidates(pcs, opts.lo, opts.hi + (style === 'spread' ? 12 : 0));
    if (style === 'spread') {
      // drop-2: the second voice from the top goes down an octave
      cands = cands
        .filter((v) => v.length >= 4)
        .map((v) => [...v.slice(0, -2), v[v.length - 1]!, v[v.length - 2]! - 12].sort((a, b) => a - b))
        .filter((v) => v[0]! >= opts.lo - 5 && v[v.length - 1]! <= opts.hi + 2);
    }
  }
  if (cands.length === 0) {
    if (style !== 'close') return voiceChord(c, prev, { ...opts, style: 'close' });
    const pcs = selectTones(c, opts);
    return candidates(pcs, opts.lo, opts.hi + 12)[0] ?? pcs.map((pc) => opts.lo + mod12(pc - opts.lo));
  }
  let best = cands[0]!;
  let bestCost = Infinity;
  for (const v of cands) {
    const cost = scoreVoicing(v, prev, mid, style === 'cluster');
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
