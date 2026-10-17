/** Ambient pad: soft upper-structure chord, held for the chord (or pulsing on half bars, per song). */
import type { NoteEvent } from '@shared/index';
import { harmonyAt } from '../form';
import { stream } from '../rng';
import { barStart, energy, humanize, note, style, type BarContext } from './context';

export function renderPad(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.pad) return [];
  const h = harmonyAt(ctx.song, ctx.rel, ctx.params.complexity);
  const rng = stream(ctx.seed, 'pad', ctx.bar);
  const vel = 0.25 + energy(ctx) * 0.4;
  const start = barStart(ctx);
  const voicing = h.slot.pad;

  if (style(ctx).padPulse) {
    return [0, 2].flatMap((b) =>
      voicing.map((midi, i) => note('pad', start + b + i * 0.03 + Math.max(0, humanize(rng, 0.02)), 1.85, midi, vel * (b === 0 ? 1 : 0.8))),
    );
  }

  if (!h.chordStart && ctx.inSection !== 0) return [];
  // hold until the chord ends or the section ends, whichever is first
  const sectionLeft = ctx.section.bars - ctx.inSection;
  const bars = Math.max(1, Math.min(h.barsLeft, sectionLeft));
  return voicing.map((midi, i) =>
    note('pad', start + i * 0.04 + Math.max(0, humanize(rng, 0.02)), bars * 4 - 0.1, midi, vel + humanize(rng, 0.03)),
  );
}
