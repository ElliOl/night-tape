/** Ambient pad: soft upper-structure chord held for the length of each chord. */
import type { NoteEvent } from '@shared/index';
import { stream } from '../rng';
import { barStart, energy, humanize, note, slot, type BarContext } from './context';

export function renderPad(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.pad) return [];
  const cur = slot(ctx);
  const loopPos = ((ctx.rel % ctx.song.loopBars) + ctx.song.loopBars) % ctx.song.loopBars;
  const sectionStart = ctx.inSection === 0;
  if (cur.startBar !== loopPos && !sectionStart) return [];
  // hold until the chord ends, the section ends or the song ends, whichever is first
  const chordLeft = cur.startBar + cur.chord.bars - loopPos;
  const sectionLeft = ctx.section.bars - ctx.inSection;
  const bars = Math.max(1, Math.min(chordLeft, sectionLeft));
  const rng = stream(ctx.seed, 'pad', ctx.bar);
  const vel = 0.35 + energy(ctx) * 0.2;
  return cur.pad.map((midi, i) =>
    note('pad', barStart(ctx) + i * 0.04 + Math.max(0, humanize(rng, 0.02)), bars * 4 - 0.1, midi, vel + humanize(rng, 0.03)),
  );
}
