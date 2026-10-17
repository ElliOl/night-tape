/**
 * Lazy, swung lofi drums. A base pattern is chosen per section; each bar may drift from it (variation),
 * fill into the next section or drop out for a classic "stop" bar.
 */
import { DRUM, type NoteEvent } from '@shared/index';
import { chance, pick, stream, type Rng } from '../rng';
import type { HatStyle } from '../moods';
import {
  barStart, energy, humanize, inBar, isSectionLastBar, isSongLastBar, liveMood, note, step16, type BarContext,
} from './context';

/** 16-step kick patterns (x = hit). The first is the most "default" boom-bap. */
export const KICKS = [
  'x.........x.....',
  'x......x..x.....',
  'x.........x..x..',
  'x..x......x.....',
  'x.......x.x.....',
  'x.x.......x.....',
  'x......x...x....',
  'x.........xx....',
] as const;

const SPARSE_KICKS = ['x.........x.....', 'x...............', 'x.......x.......'] as const;

const steps = (pattern: string): number[] => [...pattern].flatMap((c, i) => (c === 'x' ? [i] : []));

interface SectionGroove {
  kick: number[];
  hats: HatStyle;
  ghostSteps: number[];
  openHat: boolean;
  rim: boolean;
}

function sectionGroove(ctx: BarContext): SectionGroove {
  const key = `drums:${ctx.song.index}:${ctx.section.index}:${ctx.params.mood}`;
  const cached = ctx.cache.get(key) as SectionGroove | undefined;
  if (cached) return cached;
  const mood = liveMood(ctx);
  const rng = stream(ctx.seed, 'drums', ctx.song.index, ctx.section.index, ctx.params.mood);
  const soft = mood.drums !== 'boombap';
  const g: SectionGroove = {
    kick: steps(soft ? pick(rng, SPARSE_KICKS) : pick(rng, KICKS)),
    hats: pick(rng, mood.hats),
    ghostSteps: [7, 10, 15].filter(() => chance(rng, 0.35)),
    openHat: chance(rng, 0.3),
    rim: mood.drums === 'whisper' || (mood.drums === 'soft' && chance(rng, 0.6)),
  };
  ctx.cache.set(key, g);
  return g;
}

export function renderDrums(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.drums) return [];
  const out: NoteEvent[] = [];
  const mood = liveMood(ctx);
  const g = sectionGroove(ctx);
  const e = energy(ctx);
  const swing = ctx.params.swing;
  const variation = ctx.params.variation;
  const rng = stream(ctx.seed, 'drumbar', ctx.bar);
  const start = barStart(ctx);
  const whisper = mood.drums === 'whisper';
  const level = whisper ? 0.45 : mood.drums === 'soft' ? 0.75 : 1;

  const hit = (step: number, midi: number, vel: number, lag = 0, jitter = 0.008): void => {
    const beat = inBar(ctx, start + step16(step, swing) + lag + humanize(rng, jitter));
    out.push(note('drums', beat, 0.25, midi, vel * level * (0.92 + rng.next() * 0.16)));
  };

  // a "stop" bar right before a new section / song: only the downbeat, then silence
  const lastOfSection = isSectionLastBar(ctx);
  if (lastOfSection && ctx.inSection > 0 && chance(rng, isSongLastBar(ctx) ? 0.6 : 0.18 + variation * 0.2)) {
    hit(0, DRUM.kick, 0.85, 0, 0);
    return out;
  }

  // ---- kick
  let kick = g.kick;
  if (e < 0.3) kick = kick.filter((s) => s === 0 || s === 10 || s === 8);
  if (ctx.inSection > 0 && chance(rng, variation * 0.45)) {
    // drift: move, add or drop one non-downbeat kick
    const extra = pick(rng, [3, 6, 7, 9, 11, 13, 14]);
    kick = chance(rng, 0.5) ? [...kick.filter((s) => s !== extra), extra] : kick.filter((s, i) => s === 0 || i !== kick.length - 1);
  }
  if (!whisper) for (const s of kick) hit(s, DRUM.kick, s === 0 ? 0.95 : 0.78, 0, 0.004);

  // ---- backbeat (snare or rim), laid back a touch
  const back = g.rim ? DRUM.rim : DRUM.snare;
  hit(4, back, 0.85, 0.012);
  hit(12, back, 0.9, 0.015);
  if (!whisper && e > 0.35) {
    for (const s of g.ghostSteps) if (chance(rng, 0.5 + e * 0.4)) hit(s, DRUM.snare, 0.22, 0.01);
  }
  // fill into the next section: soft ghost roll on the last beat
  if (lastOfSection && !whisper && chance(rng, 0.35 + variation * 0.4)) {
    for (const s of [13, 14, 15]) hit(s, DRUM.snare, 0.18 + (s - 13) * 0.08, 0.008);
  }

  // ---- hats / shaker
  renderHats(ctx, g, e, rng, hit);
  return out;
}

function renderHats(
  ctx: BarContext,
  g: SectionGroove,
  e: number,
  rng: Rng,
  hit: (step: number, midi: number, vel: number, lag?: number, jitter?: number) => void,
): void {
  // hats drop out for the first half of some bars to let the groove breathe
  const dropHalf = ctx.inSection > 0 && chance(rng, ctx.params.variation * 0.12);
  for (let s = 0; s < 16; s++) {
    if (dropHalf && s < 8) continue;
    const onBeat = s % 4 === 0;
    const offEighth = s % 4 === 2;
    switch (g.hats) {
      case 'eighths':
        if (s % 2 === 0) hit(s, DRUM.hatClosed, onBeat ? 0.55 : 0.38);
        else if (e > 0.75 && chance(rng, 0.25)) hit(s, DRUM.hatClosed, 0.18);
        break;
      case 'sixteenths':
        if (s % 2 === 0) hit(s, DRUM.hatClosed, onBeat ? 0.5 : offEighth ? 0.42 : 0.3);
        else if (chance(rng, 0.25 + e * 0.5)) hit(s, DRUM.hatClosed, 0.16 + rng.next() * 0.1);
        break;
      case 'shaker':
        if (e > 0.2 || s % 2 === 0) hit(s, DRUM.shaker, offEighth ? 0.5 : s % 2 === 0 ? 0.32 : 0.2, 0, 0.012);
        break;
    }
  }
  if (g.openHat && e > 0.45 && chance(rng, 0.6)) hit(14, DRUM.hatOpen, 0.35);
}
