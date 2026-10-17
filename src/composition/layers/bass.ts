/** Round, laid-back bass: roots on the one, fifths and chromatic approach notes into chord changes. */
import type { NoteEvent } from '@shared/index';
import { chance, pick, stream } from '../rng';
import type { BassStyle } from '../moods';
import { mod12 } from '../theory';
import {
  barStart, chordChangesNext, energy, humanize, isSongLastBar, liveMood, nextSlot, note, slot, step16, type BarContext,
} from './context';

function sectionBass(ctx: BarContext): BassStyle {
  const key = `bass:${ctx.song.index}:${ctx.section.index}:${ctx.params.mood}`;
  const cached = ctx.cache.get(key) as BassStyle | undefined;
  if (cached) return cached;
  const style = pick(stream(ctx.seed, 'bass', ctx.song.index, ctx.section.index, ctx.params.mood), liveMood(ctx).basses);
  ctx.cache.set(key, style);
  return style;
}

/** The chord's fifth (or b5 for half-diminished) in the bass register. */
function fifthAbove(root: number, quality: string): number {
  return root + (quality === 'm7b5' ? 6 : 7);
}

export function renderBass(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.bass) return [];
  const out: NoteEvent[] = [];
  const rng = stream(ctx.seed, 'bassbar', ctx.bar);
  const cur = slot(ctx);
  const root = cur.bass;
  const start = barStart(ctx);
  const swing = ctx.params.swing;
  const e = energy(ctx);
  let style = sectionBass(ctx);
  if (e < 0.25 && style !== 'held') style = 'dub';
  const changes = chordChangesNext(ctx) && !isSongLastBar(ctx);
  const next = nextSlot(ctx).bass;
  const vel = 0.62 + e * 0.2;

  const play = (step: number, len: number, midi: number, v = vel): void => {
    const beat = start + step16(step, swing) + Math.max(0, humanize(rng, 0.006));
    out.push(note('bass', beat, len, midi, v + humanize(rng, 0.04)));
  };

  // held / slow chords: one note per chord (re-struck softly on long chords)
  const chordStartsHere = ctx.rel === 0 || cur.startBar === mod(ctx.rel, ctx.song.loopBars);
  switch (style) {
    case 'held':
      if (chordStartsHere) play(0, changes ? 3.8 : 4.4, root);
      else if (chance(rng, 0.5)) play(8, 1.8, root, vel * 0.8);
      break;
    case 'dub':
      play(0, 1.4, root);
      if (chance(rng, 0.7)) play(11, 0.6, root, vel * 0.85);
      if (changes && chance(rng, 0.5)) play(14, 0.4, approach(root, next), vel * 0.75);
      break;
    case 'pulse':
      play(0, 1.6, root);
      play(6, 0.4, root, vel * 0.8);
      play(10, 0.9, chance(rng, 0.4) ? root + 12 : root, vel * 0.85);
      if (changes && chance(rng, 0.6)) play(14, 0.4, approach(root, next), vel * 0.8);
      break;
    case 'walkup': {
      play(0, 1.8, root);
      const fifth = fifthAbove(root, cur.chord.quality);
      play(8, 0.9, chance(rng, 0.5) ? fifth : fifth - 12 >= 28 ? fifth - 12 : fifth, vel * 0.85);
      if (changes) play(12, 0.9, approach(root, next), vel * 0.8);
      else if (chance(rng, 0.5)) play(12, 0.9, root + (chance(rng, 0.5) ? 12 : 10), vel * 0.75);
      break;
    }
  }
  return out;
}

/** Chromatic approach into `target` from the side closest to the current root. */
function approach(root: number, target: number): number {
  return target + (mod12(target - root) <= 6 ? -1 : 1);
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
