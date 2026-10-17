/**
 * Sparse, singable melody. Each section owns a two-bar motif (rhythm + contour in scale steps) that is
 * stated, answered, restated and left to breathe:  A  A'  A  (tail)  per 8 bars.
 * Strong or long notes snap to chord tones so the line never fights the harmony.
 */
import type { NoteEvent } from '@shared/index';
import { chance, int, stream, weightedPick, type Rng } from '../rng';
import { chordPcs, clamp, melodyScale, mod12, nearestInSet } from '../theory';
import { barStart, energy, humanize, liveMood, note, slot, step8, type BarContext } from './context';

interface MotifNote {
  /** eighth index inside the 2-bar motif, 0..15 */
  at: number;
  /** length in eighths */
  len: number;
  /** scale-step index (0 = tonic of the melody register) */
  step: number;
}

interface Motif {
  notes: MotifNote[];
}

/** MIDI tonic at the bottom of the melody register (G3..F#4); motifs sit mostly an octave above. */
export function registerBase(tonic: number): number {
  return 55 + mod12(tonic - 7);
}

export function makeMotif(rng: Rng, density: number): Motif {
  // onsets: favour off-beats and beat 2/3, leave the end of bar 2 open for a breath
  const weights = [0.5, 0.9, 0.7, 1, 0.8, 0.9, 0.6, 0.7, 0.45, 0.85, 0.6, 0.8, 0.35, 0.3, 0.1, 0.05];
  const count = clamp(Math.round(2 + density * 6 + rng.next() * 1.5), 2, 9);
  const onsets = new Set<number>();
  let guard = 0;
  while (onsets.size < count && guard++ < 200) {
    const i = int(rng, 0, 15);
    if (rng.next() < weights[i]!) onsets.add(i);
  }
  const sorted = [...onsets].sort((a, b) => a - b);
  let step: number = weightedPick(rng, [[2, 2], [4, 3], [5, 2], [7, 1]] as const);
  const notes: MotifNote[] = sorted.map((at, i) => {
    const nextAt = sorted[i + 1] ?? 16;
    const len = Math.max(1, Math.min(nextAt - at, i === sorted.length - 1 ? 6 : 4));
    if (i > 0) step = clamp(step + weightedPick(rng, [[-2, 2], [-1, 4], [1, 4], [2, 2], [0, 1], [3, 1], [-3, 1]] as const), 0, 10);
    return { at, len, step };
  });
  return { notes };
}

function sectionMotif(ctx: BarContext): Motif {
  const key = `motif:${ctx.song.index}:${ctx.section.index}`;
  const cached = ctx.cache.get(key) as Motif | undefined;
  if (cached) return cached;
  const density = clamp(liveMood(ctx).melodyDensity * 0.6 + ctx.params.complexity * 0.5, 0, 1);
  // sections with the same name inside a song share their theme (recognisable "hook")
  const sameName = ctx.song.sections.find((s) => s.name === ctx.section.name);
  const motif = makeMotif(stream(ctx.seed, 'motif', ctx.song.index, sameName?.index ?? ctx.section.index), density);
  ctx.cache.set(key, motif);
  return motif;
}

export function renderMelody(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.melody) return [];
  const phraseBar = ctx.inSection % 8;
  // bar 6-7 of each 8 bar phrase: a single held tail note (or silence)
  const rng = stream(ctx.seed, 'melbar', ctx.bar);
  const motif = sectionMotif(ctx);
  const scale = melodyScale(ctx.song.key);
  const base = registerBase(ctx.song.key.tonic);
  const chord = slot(ctx).chord;
  const pcsChord = chordPcs(chord);
  const start = barStart(ctx);
  const swing = ctx.params.swing;
  const vel = 0.5 + energy(ctx) * 0.2;
  const out: NoteEvent[] = [];

  const toMidi = (step: number): number => {
    const oct = Math.floor(step / scale.length);
    const deg = scale[((step % scale.length) + scale.length) % scale.length]!;
    return base + oct * 12 + deg;
  };

  if (phraseBar >= 6) {
    if (phraseBar === 6 && chance(rng, 0.6)) {
      const m = nearestInSet(toMidi(int(rng, 2, 6)), pcsChord);
      out.push(note('melody', start + step8(int(rng, 0, 2), swing), 5, m, vel * 0.85));
    }
    return out;
  }

  const half = phraseBar % 2; // which bar of the 2-bar motif
  const answer = phraseBar === 2 || phraseBar === 3; // second statement: resolve the ending
  const variation = ctx.params.variation;
  const inBar = motif.notes.filter((n) => Math.floor(n.at / 8) === half);
  inBar.forEach((n, i) => {
    let step = n.step;
    const last = i === inBar.length - 1;
    if (answer && half === 1 && last) step = Math.round(step / scale.length) * scale.length; // land on the tonic
    if (chance(rng, variation * 0.2)) step += chance(rng, 0.5) ? 1 : -1;
    if (chance(rng, variation * 0.1)) return; // occasionally leave a note out
    const i8 = n.at - half * 8;
    let midi = toMidi(step);
    const strong = i8 % 4 === 0 || n.len >= 3;
    if (strong) midi = nearestInSet(midi, pcsChord);
    const lenBeats = (n.len / 2) * 0.92;
    const beat = start + step8(i8, swing) + Math.max(0, humanize(rng, 0.012));
    out.push(note('melody', beat, lenBeats, midi, vel * (strong ? 1 : 0.88) + humanize(rng, 0.05)));
  });
  return out;
}
