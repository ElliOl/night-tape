/** Laid-back bass: roots on the one, fifths, walking lines and chromatic approach notes into chord changes. */
import type { NoteEvent } from '@shared/index';
import { chance, pick, stream } from '../rng';
import type { BassStyle } from '../moods';
import { QUALITY_INTERVALS, mod12 } from '../theory';
import {
  barStart, chordChangesNext, drift, energy, humanize, isChordStartBar, isSongLastBar, nextSlot, note, slot, step16, style,
  type BarContext,
  songSwing,
} from './context';

function sectionBass(ctx: BarContext): BassStyle {
  const key = `bass:${ctx.song.index}:${ctx.section.index}`;
  const cached = ctx.cache.get(key) as BassStyle | undefined;
  if (cached) return cached;
  const b = pick(stream(ctx.seed, 'bass', ctx.song.index, ctx.section.index), style(ctx).basses);
  ctx.cache.set(key, b);
  return b;
}

/** Chord tones (as offsets above the root, inside an octave) for walking lines. */
function chordOffsets(quality: keyof typeof QUALITY_INTERVALS): number[] {
  return [...new Set(QUALITY_INTERVALS[quality].map((iv) => iv % 12))].filter((iv) => iv !== 0);
}

export function renderBass(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.bass) return [];
  const out: NoteEvent[] = [];
  const rng = stream(ctx.seed, 'bassbar', ctx.bar);
  const cur = slot(ctx);
  const root = cur.bass;
  const start = barStart(ctx);
  const swing = songSwing(ctx);
  const e = energy(ctx);
  let bassStyle = sectionBass(ctx);
  if (e < 0.22 && bassStyle !== 'held') bassStyle = 'dub';
  if (e > 0.8 && bassStyle === 'dub') bassStyle = 'pulse';
  // drift occasionally swaps in a different figure for a bar
  if (ctx.inSection > 0 && chance(rng, drift(ctx) * 0.25)) bassStyle = pick(rng, style(ctx).basses);
  const changes = chordChangesNext(ctx) && !isSongLastBar(ctx);
  const next = nextSlot(ctx).bass;
  const vel = 0.45 + e * 0.5;
  const lag = style(ctx).laziness * 0.02;

  const play = (step: number, len: number, midi: number, v = vel): void => {
    const beat = start + step16(step, swing) + lag + Math.max(0, humanize(rng, 0.006));
    out.push(note('bass', beat, len, midi, v + humanize(rng, 0.04)));
  };

  const chordStartsHere = isChordStartBar(ctx);
  switch (bassStyle) {
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
      const fifth = root + (cur.chord.quality === 'm7b5' ? 6 : 7);
      play(8, 0.9, fifth, vel * 0.85);
      if (changes) play(12, 0.9, approach(root, next), vel * 0.8);
      else if (chance(rng, 0.5)) play(12, 0.9, root + (chance(rng, 0.5) ? 12 : 10), vel * 0.75);
      break;
    }
    case 'walking': {
      // four quarter notes: root, two chord tones, approach into the next bar
      const tones = chordOffsets(cur.chord.quality);
      const t1 = root + pick(rng, tones);
      const t2 = root + pick(rng, tones.filter((t) => root + t !== t1).length ? tones.filter((t) => root + t !== t1) : tones);
      const target = changes ? next : root;
      play(0, 0.92, root);
      play(4, 0.92, t1, vel * 0.85);
      play(8, 0.92, t2, vel * 0.88);
      play(12, 0.92, chance(rng, 0.6) ? approach(t2, target) : target + 7 - 12, vel * 0.82);
      break;
    }
    case 'octaves':
      for (let s = 0; s < 16; s += 2) {
        if (s === 14 && changes) play(s, 0.4, approach(root, next), vel * 0.8);
        else play(s, 0.35, s % 4 === 2 ? root + 12 : root, s % 4 === 0 ? vel : vel * 0.7);
      }
      break;
    case 'syncopated':
      play(0, 0.7, root);
      play(3, 0.4, root, vel * 0.8);
      play(6, 0.5, root + 12, vel * 0.75);
      play(10, 0.6, root + (chance(rng, 0.5) ? 7 : 10), vel * 0.85);
      if (changes) play(14, 0.4, approach(root, next), vel * 0.8);
      else if (chance(rng, 0.5)) play(13, 0.4, root, vel * 0.7);
      break;
  }
  return out;
}

/** Chromatic approach into `target` from the side closest to `from`. */
function approach(from: number, target: number): number {
  return target + (mod12(target - from) <= 6 ? -1 : 1);
}
