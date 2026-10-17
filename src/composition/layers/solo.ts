/**
 * Improvised solo lines. A solo is built from two-bar phrases: rhythm cells per beat (quarters, 8ths, 16th runs,
 * triplets, rests), a contour that rises then falls, chord tones on strong beats approached from a half step below,
 * a blue note now and then in minor keys, and a breath (held note or rest) at the end of each phrase.
 * Phrases are generated whole and deterministically, then cut per bar, so a line flows across the bar line.
 */
import type { LayerId, NoteEvent } from '@shared/index';
import { harmonyAt } from '../form';
import { chance, int, stream, weightedPick, type Rng } from '../rng';
import { chordPcs, clamp, isMinorScale, melodyScale, mod12, nearestInSet } from '../theory';
import { barStart, drift, energy, humanize, note, swingRatio, type BarContext } from './context';

interface PhraseNote {
  /** beat offset inside the 2-bar phrase (0..8) */
  at: number;
  len: number;
  midi: number;
  vel: number;
}

/** [onsets within a beat, note length] */
type Cell = readonly [readonly number[], number];
const CELLS: ReadonlyArray<readonly [Cell, number]> = [
  [[[0], 1], 2],
  [[[0, 0.5], 0.5], 4],
  [[[0.5], 0.5], 2],
  [[[0, 0.25, 0.5, 0.75], 0.25], 2],
  [[[0, 1 / 3, 2 / 3], 1 / 3], 2],
  [[[0, 0.75], 0.25], 2],
  [[[], 0], 2],
];

function scalePitches(ctx: BarContext, lo: number, hi: number): number[] {
  const key = ctx.song.key;
  const pcs = melodyScale(key).map((d) => mod12(key.tonic + d));
  if (isMinorScale(key.scale)) pcs.push(mod12(key.tonic + 6)); // blue note
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(mod12(m))) out.push(m);
  return out;
}

function makePhrase(ctx: BarContext, phraseRel: number, rng: Rng, lo: number, hi: number): PhraseNote[] {
  const e = energy(ctx);
  const density = clamp(0.25 + e * 0.5 + ctx.params.complexity * 0.4, 0, 1);
  const pitches = scalePitches(ctx, lo, hi);
  const swing = swingRatio(ctx.params.swing);
  const notes: PhraseNote[] = [];
  let idx = int(rng, Math.floor(pitches.length * 0.25), Math.floor(pitches.length * 0.55));
  // contour: climb for the first part of the phrase, then come down
  const peakBeat = 3 + rng.next() * 3;
  const beats = chance(rng, 0.7) ? 7 : 8; // usually leave the last beat to breathe
  for (let b = 0; b < beats; b++) {
    const cell = weightedPick(rng, CELLS.map(([c, w]) => {
      const busy = c[0].length >= 3;
      return [c, busy ? w * density * 2 : c[0].length === 0 ? w * (1 - density) : w] as const;
    }));
    const [onsets, len] = cell;
    const bar = b < 4 ? 0 : 1;
    const h = harmonyAt(ctx.song, Math.min(ctx.song.lengthBars - 1, phraseRel + bar), ctx.params.complexity);
    const chordTones = chordPcs(h.slot.chord);
    onsets.forEach((o, k) => {
      const dir = b + o < peakBeat ? 1 : -1;
      const step = weightedPick(rng, [[1, 5], [2, 2], [0, 1], [-1, 2], [3, 1]] as const) * dir;
      idx = clamp(idx + step, 0, pitches.length - 1);
      let midi = pitches[idx]!;
      const strong = o === 0 && (b % 2 === 0);
      if (strong) midi = nearestInSet(midi, chordTones);
      // swing the off-8ths like the drums
      const at = b + (o === 0.5 ? swing : o === 0.75 ? 0.5 + swing * 0.5 : o);
      notes.push({ at, len: len * 0.9, midi, vel: (strong ? 0.85 : 0.68) * (k === 0 ? 1 : 0.9) });
    });
  }
  // approach tones: the note before a strong-beat chord tone slides in from a half step below
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i]!;
    const prev = notes[i - 1]!;
    if (n.at % 2 === 0 && n.at - prev.at <= 0.5 && chance(rng, 0.45)) prev.midi = n.midi - 1;
  }
  // end of phrase: hold the last note into the breath
  const last = notes[notes.length - 1];
  if (last) last.len = Math.max(last.len, beats + 0.9 - last.at);
  return notes;
}

/**
 * Notes of the solo for this bar on `layer`, in [lo, hi]. Bars pair up into phrases from the section start.
 * Returns [] outside Solo sections.
 */
export function renderSolo(ctx: BarContext, layer: LayerId, lo: number, hi: number): NoteEvent[] {
  if (ctx.section.name !== 'Solo') return [];
  const half = ctx.inSection % 2;
  const phraseRel = ctx.rel - half;
  const rng = stream(ctx.seed, 'solo', ctx.song.index, ctx.section.index, phraseRel);
  const phrase = makePhrase(ctx, phraseRel, rng, lo, hi);
  const out: NoteEvent[] = [];
  const start = barStart(ctx) - half * 4;
  const jitter = stream(ctx.seed, 'solojit', ctx.bar);
  const loose = 0.008 + drift(ctx) * 0.012;
  for (const n of phrase) {
    if (Math.floor(n.at / 4) !== half) continue;
    const beat = start + n.at + Math.max(0, humanize(jitter, loose));
    out.push(note(layer, beat, n.len, n.midi, n.vel * (0.55 + energy(ctx) * 0.5)));
  }
  return out;
}
