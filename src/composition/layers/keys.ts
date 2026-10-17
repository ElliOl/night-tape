/**
 * Electric-piano comping. Rhythms come from a small vocabulary per mood; chords are lightly rolled,
 * the top voice sings a little louder, and "push" bars anticipate the next chord on the last off-beat.
 */
import type { NoteEvent } from '@shared/index';
import { chance, pick, stream } from '../rng';
import type { CompStyle } from '../moods';
import {
  barStart, chordChangesNext, energy, humanize, isSectionLastBar, liveMood, nextSlot, note, slot, step8, type BarContext,
} from './context';

/** [eighth index, length in eighths] */
type Hit = readonly [number, number];

const COMPS: Record<CompStyle, readonly Hit[]> = {
  whole: [[0, 8]],
  halves: [[0, 4], [4, 4]],
  charleston: [[0, 3], [3, 5]],
  push: [[0, 3], [4, 3]],
  lazy: [[1, 3], [5, 3]],
  rolled: [[0, 8]],
};

function sectionComp(ctx: BarContext): CompStyle {
  const key = `comp:${ctx.song.index}:${ctx.section.index}:${ctx.params.mood}`;
  const cached = ctx.cache.get(key) as CompStyle | undefined;
  if (cached) return cached;
  const style = pick(stream(ctx.seed, 'comp', ctx.song.index, ctx.section.index, ctx.params.mood), liveMood(ctx).comps);
  ctx.cache.set(key, style);
  return style;
}

/** Does the bar anticipate the next chord on its last eighth? Deterministic per bar. */
export function pushesInto(ctx: BarContext, bar: number): boolean {
  const style = sectionComp(ctx);
  if (style === 'whole' || style === 'rolled') return false;
  const p = style === 'push' ? 0.8 : 0.15 + ctx.params.variation * 0.25;
  return chance(stream(ctx.seed, 'push', bar), p);
}

export function renderKeys(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.keys) return [];
  const out: NoteEvent[] = [];
  const rng = stream(ctx.seed, 'keys', ctx.bar);
  const style = sectionComp(ctx);
  const cur = slot(ctx);
  const start = barStart(ctx);
  const swing = ctx.params.swing;
  const e = energy(ctx);
  const sparse = ctx.section.name === 'Intro' || ctx.section.name === 'Dawn' || ctx.section.name === 'Dusk';
  const baseVel = 0.42 + e * 0.22;

  // bars that don't start a chord in slow progressions re-strike softly (or not at all)
  const chordStart = ctx.rel === 0 || cur.startBar === ((ctx.rel % ctx.song.loopBars) + ctx.song.loopBars) % ctx.song.loopBars;
  let hits: readonly Hit[] = COMPS[style];
  if (sparse || (!chordStart && (style === 'whole' || style === 'rolled'))) hits = chordStart ? [[0, 8]] : [];
  if (!sparse && ctx.inSection > 0 && chance(rng, ctx.params.variation * 0.3)) hits = COMPS[pick(rng, liveMood(ctx).comps)];

  // previous bar pushed into this one: its downbeat is already sounding
  const pushedIn = !sparse && ctx.inSection > 0 && chordStart && pushesInto(ctx, ctx.bar - 1);
  const pushOut = !sparse && chordChangesNext(ctx) && !isSectionLastBar(ctx) && pushesInto(ctx, ctx.bar);

  const roll = style === 'rolled' || sparse ? 0.06 + rng.next() * 0.05 : 0.012 + rng.next() * 0.02;
  const play = (voicing: readonly number[], at: number, lenBeats: number, vel: number): void => {
    voicing.forEach((midi, i) => {
      const top = i === voicing.length - 1;
      const beat = start + at + i * roll + Math.max(0, humanize(rng, 0.01));
      out.push(note('keys', beat, Math.max(0.2, lenBeats - i * roll), midi, vel * (top ? 1.08 : 0.9) + humanize(rng, 0.04)));
    });
  };

  for (const [i8, len8] of hits) {
    if (pushedIn && i8 === 0) continue;
    const at = step8(i8, swing);
    let endAt = Math.min(4, step8(Math.min(8, i8 + len8), swing));
    if (pushOut && i8 + len8 > 7) endAt = Math.min(endAt, step8(7, swing));
    const len = (endAt - at) * 0.94;
    if (len < 0.15) continue;
    play(cur.keys, at, len, baseVel * (i8 === 0 ? 1 : 0.85));
  }

  if (pushOut) {
    const at = step8(7, swing);
    play(nextSlot(ctx).keys, at, 4 - at + 0.45, baseVel * 0.95);
  }
  return out;
}
