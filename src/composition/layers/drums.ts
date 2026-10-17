/**
 * Lofi drums in several groove families (boom-bap, half-time, drunk Dilla swing, brushes, bossa, two-step, sparse,
 * whisper). Each song has one family; each section picks a pattern within it; each bar may drift from it (variation),
 * fill into the next section or drop out for a classic "stop" bar.
 */
import { DRUM, type NoteEvent } from '@shared/index';
import { chance, pick, stream, type Rng } from '../rng';
import type { DrumFamily, HatStyle } from '../moods';
import {
  barStart, drift, energy, humanize, inBar, isSectionLastBar, isSongLastBar, note, step16, style, swingRatio, type BarContext,
} from './context';

/** 16-step kick patterns (x = hit). */
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

const FAMILY_KICKS: Partial<Record<DrumFamily, readonly string[]>> = {
  halftime: ['x.........x.....', 'x......x.....x..', 'x..........x....', 'x.x.........x...'],
  dilla: ['x......x.x....x.', 'x..x.....x.x....', 'x.....x...x..x..', 'x.......x..x..x.'],
  twostep: ['x......x..x.....', 'x......x..x..x..', 'x.....x...x.....'],
  bossa: ['x.....x.x.....x.'],
  sparse: ['x.........x.....', 'x.......x.......', 'x...............'],
  brushes: ['x...x...x...x...'],
};

const steps = (pattern: string): number[] => [...pattern].flatMap((c, i) => (c === 'x' ? [i] : []));

interface SectionGroove {
  kick: number[];
  hats: HatStyle;
  ghostSteps: number[];
  openHat: boolean;
}

const FAMILY_HATS: Record<DrumFamily, readonly HatStyle[]> = {
  boombap: ['eighths', 'sixteenths'],
  halftime: ['sixteenths', 'eighths'],
  dilla: ['sixteenths', 'eighths'],
  brushes: ['ride'],
  bossa: ['shaker'],
  twostep: ['offbeat'],
  sparse: ['shaker', 'eighths'],
  whisper: ['shaker'],
};

function sectionGroove(ctx: BarContext): SectionGroove {
  const key = `drums:${ctx.song.index}:${ctx.section.index}`;
  const cached = ctx.cache.get(key) as SectionGroove | undefined;
  if (cached) return cached;
  const fam = style(ctx).drumFamily;
  const rng = stream(ctx.seed, 'drums', ctx.song.index, ctx.section.index);
  const g: SectionGroove = {
    kick: steps(pick(rng, FAMILY_KICKS[fam] ?? KICKS)),
    hats: pick(rng, FAMILY_HATS[fam]),
    ghostSteps: [7, 10, 15].filter(() => chance(rng, 0.35)),
    openHat: chance(rng, fam === 'twostep' ? 0.8 : 0.3),
  };
  ctx.cache.set(key, g);
  return g;
}

type Hit = (step: number, midi: number, vel: number, lag?: number, jitter?: number) => void;

export function renderDrums(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.drums) return [];
  const out: NoteEvent[] = [];
  const st = style(ctx);
  const fam = st.drumFamily;
  const g = sectionGroove(ctx);
  const e = energy(ctx);
  const swing = ctx.params.swing;
  const v = drift(ctx);
  const rng = stream(ctx.seed, 'drumbar', ctx.bar);
  const start = barStart(ctx);
  const level = fam === 'whisper' ? 0.45 : fam === 'sparse' || fam === 'brushes' ? 0.75 : 1;
  const loose = fam === 'dilla' ? 0.028 : 0.006;
  const lag = 0.006 + st.laziness * 0.04;
  // energy scales how hard everything is hit
  const force = 0.6 + e * 0.6;

  const hit: Hit = (step, midi, vel, lagBeats = 0, jitter = loose) => {
    const beat = inBar(ctx, start + step16(step, swing) + lagBeats + humanize(rng, jitter));
    out.push(note('drums', beat, 0.25, midi, vel * level * force * (0.9 + rng.next() * 0.2)));
  };

  // a "stop" bar right before a new section / song: only the downbeat, then silence
  const lastOfSection = isSectionLastBar(ctx);
  if (lastOfSection && ctx.inSection > 0 && fam !== 'whisper' && chance(rng, isSongLastBar(ctx) ? 0.6 : 0.12 + v * 0.35)) {
    hit(0, DRUM.kick, 0.85, 0, 0);
    return out;
  }

  // ---- kick
  let kick = g.kick;
  if (e < 0.3) kick = kick.filter((s) => s === 0 || s === 8 || s === 10);
  if (e > 0.78 && fam !== 'brushes' && fam !== 'bossa' && chance(rng, 0.5)) kick = [...kick, 13];
  if (ctx.inSection > 0 && fam !== 'bossa' && chance(rng, v * 0.7)) {
    // drift: add or drop one non-downbeat kick
    const extra = pick(rng, [3, 6, 7, 9, 11, 13, 14]);
    kick = chance(rng, 0.5) ? [...kick.filter((s) => s !== extra), extra] : kick.filter((s, i) => s === 0 || i !== kick.length - 1);
  }
  if (fam !== 'whisper') {
    const kv = fam === 'brushes' ? 0.3 : 0.95;
    for (const s of kick) hit(s, DRUM.kick, s === 0 ? kv : kv * 0.82, 0, fam === 'dilla' ? 0.02 : 0.004);
  }

  // ---- backbeat
  switch (fam) {
    case 'halftime':
      hit(8, DRUM.snare, 0.95, lag);
      if (e > 0.5 && chance(rng, 0.5)) hit(12, DRUM.rim, 0.4, lag);
      break;
    case 'bossa': {
      // 2-3 bossa clave on the rim, alternating bars
      const clave = ctx.inSection % 2 === 0 ? [0, 6, 12] : [4, 10];
      for (const s of clave) hit(s, DRUM.rim, 0.7);
      break;
    }
    case 'sparse':
    case 'whisper':
      hit(4, DRUM.rim, 0.8, lag);
      hit(12, DRUM.rim, 0.85, lag);
      break;
    case 'twostep':
      hit(4, DRUM.clap, 0.85, lag * 0.5);
      hit(12, DRUM.clap, 0.9, lag * 0.5);
      break;
    case 'brushes':
      hit(4, DRUM.snare, 0.45, lag);
      hit(12, DRUM.snare, 0.5, lag);
      break;
    default:
      hit(4, DRUM.snare, 0.85, lag);
      hit(12, DRUM.snare, 0.9, lag + 0.003);
  }
  if ((fam === 'boombap' || fam === 'dilla' || fam === 'halftime') && e > 0.3) {
    for (const s of g.ghostSteps) if (chance(rng, 0.35 + e * 0.6)) hit(s, DRUM.snare, 0.2, lag);
  }
  // fill into the next section: soft ghost roll on the last beat
  if (lastOfSection && fam !== 'whisper' && fam !== 'bossa' && chance(rng, 0.25 + v * 0.6)) {
    for (const s of [13, 14, 15]) hit(s, DRUM.snare, 0.18 + (s - 13) * 0.1, lag);
  }

  renderHats(ctx, g, e, v, rng, hit, out, start);
  return out;
}

function renderHats(ctx: BarContext, g: SectionGroove, e: number, v: number, rng: Rng, hit: Hit, out: NoteEvent[], start: number): void {
  // hats drop out for the first half of some bars to let the groove breathe
  const dropHalf = ctx.inSection > 0 && chance(rng, v * 0.2);
  if (g.hats === 'ride') {
    // jazz ride: 1, 2, (2a), 3, 4, (4a) with a triplet-ish skip note
    const skip = 0.5 + (swingRatio(ctx.params.swing) - 0.5) * 1.2 + 0.08;
    for (const b of [0, 1, 1 + skip, 2, 3, 3 + skip]) {
      if (dropHalf && b < 2) continue;
      const accent = b === 1 || b === 3 ? 0.55 : 0.4;
      out.push(note('drums', inBar(ctx, start + b + humanize(rng, 0.008)), 0.5, DRUM.ride, accent * (0.6 + e * 0.6)));
    }
    return;
  }
  for (let s = 0; s < 16; s++) {
    if (dropHalf && s < 8) continue;
    const onBeat = s % 4 === 0;
    const offEighth = s % 4 === 2;
    switch (g.hats) {
      case 'eighths':
        if (s % 2 === 0) hit(s, DRUM.hatClosed, onBeat ? 0.55 : 0.38);
        else if (e > 0.6 && chance(rng, (e - 0.6) * 1.5)) hit(s, DRUM.hatClosed, 0.18);
        break;
      case 'sixteenths':
        if (s % 2 === 0) hit(s, DRUM.hatClosed, onBeat ? 0.5 : offEighth ? 0.42 : 0.3);
        else if (chance(rng, 0.1 + e * 0.8)) hit(s, DRUM.hatClosed, 0.14 + rng.next() * 0.12);
        break;
      case 'offbeat':
        if (offEighth) hit(s, s === 14 && g.openHat ? DRUM.hatOpen : DRUM.hatClosed, 0.55);
        else if (e > 0.45 && s % 2 === 1 && chance(rng, e * 0.5)) hit(s, DRUM.hatClosed, 0.16);
        break;
      case 'shaker':
        if (e > 0.25 || s % 2 === 0) hit(s, DRUM.shaker, offEighth ? 0.5 : s % 2 === 0 ? 0.32 : 0.2, 0, 0.012);
        break;
      default:
        break;
    }
  }
  if (g.openHat && g.hats !== 'offbeat' && g.hats !== 'shaker' && e > 0.4 && chance(rng, 0.6)) hit(14, DRUM.hatOpen, 0.35);
}
