/**
 * Keys comping. Each song draws 2-3 rhythms from its station's vocabulary (held, Charleston, pushes, stabs, bossa,
 * pulses, arpeggios...); chords are lightly rolled, the top voice sings a little louder, and "push" bars anticipate
 * the next chord on the last off-beat. In a keys solo the left hand thins out and renderSolo() plays the line.
 */
import type { NoteEvent } from '@shared/index';
import { chance, pick, stream } from '../rng';
import type { CompStyle } from '../moods';
import {
  barStart, chordChangesNext, drift, energy, humanize, isChordStartBar, isSectionLastBar, nextSlot, note, slot, step16, style,
  type BarContext,
} from './context';
import { renderSolo } from './solo';

/** [16th step, length in 16ths] */
type Hit = readonly [number, number];

const COMPS: Record<CompStyle, readonly Hit[]> = {
  whole: [[0, 16]],
  halves: [[0, 8], [8, 8]],
  charleston: [[0, 6], [6, 10]],
  push: [[0, 6], [8, 6]],
  lazy: [[2, 6], [10, 6]],
  rolled: [[0, 16]],
  arp: [],
  stabs: [[0, 2], [3, 2], [6, 3], [11, 2]],
  bossa: [[0, 3], [3, 3], [8, 3], [11, 3], [14, 2]],
  pulse: [[0, 2], [4, 2], [8, 2], [12, 2]],
};

const NO_PUSH = new Set<CompStyle>(['whole', 'rolled', 'arp', 'pulse']);
/** broken-chord order over eight 8ths (indices into the voicing, wrapped) */
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3];

function sectionComp(ctx: BarContext): CompStyle {
  const key = `comp:${ctx.song.index}:${ctx.section.index}`;
  const cached = ctx.cache.get(key) as CompStyle | undefined;
  if (cached) return cached;
  const comp = pick(stream(ctx.seed, 'comp', ctx.song.index, ctx.section.index), style(ctx).comps);
  ctx.cache.set(key, comp);
  return comp;
}

const isSparse = (ctx: BarContext): boolean =>
  ctx.section.name === 'Intro' || ctx.section.name === 'Dawn' || ctx.section.name === 'Dusk';
const isKeysSolo = (ctx: BarContext): boolean => ctx.section.name === 'Solo' && style(ctx).soloist === 'keys';

/** Does `bar` anticipate the next chord on its last off-beat? Deterministic per bar. */
export function pushesInto(ctx: BarContext, bar: number): boolean {
  const comp = sectionComp(ctx);
  if (NO_PUSH.has(comp)) return false;
  const p = comp === 'push' ? 0.85 : 0.1 + drift(ctx) * 0.45;
  return chance(stream(ctx.seed, 'push', bar), p);
}

export function renderKeys(ctx: BarContext): NoteEvent[] {
  if (!ctx.section.layers.keys) return [];
  const out: NoteEvent[] = [];
  const rng = stream(ctx.seed, 'keys', ctx.bar);
  const comp = sectionComp(ctx);
  const cur = slot(ctx);
  const start = barStart(ctx);
  const swing = ctx.params.swing;
  const e = energy(ctx);
  const sparse = isSparse(ctx);
  const solo = isKeysSolo(ctx);
  const lag = style(ctx).laziness * 0.03;
  // energy moves the touch a lot: whisper-soft at 0, hammering at 1
  const baseVel = (0.26 + e * 0.52) * (solo ? 0.7 : 1);
  const chordStart = isChordStartBar(ctx);

  // guitar chords are strummed, everything else is lightly rolled
  const guitar = style(ctx).palette.keys === 'guitar';
  const roll = guitar ? 0.035 + rng.next() * 0.03 : comp === 'rolled' || sparse ? 0.06 + rng.next() * 0.06 : 0.01 + rng.next() * 0.025;
  const shift = style(ctx).keysShift;
  const play = (voicing: readonly number[], at: number, lenBeats: number, vel: number): void => {
    // strum alternates down/up on guitar
    const ordered = guitar && Math.round(at * 2) % 2 === 1 ? [...voicing].reverse() : voicing;
    ordered.forEach((m, i) => {
      const midi = m + shift;
      const top = m === voicing[voicing.length - 1];
      const beat = start + at + lag + i * roll + Math.max(0, humanize(rng, 0.01));
      out.push(note('keys', beat, Math.max(0.15, lenBeats - i * roll), midi, vel * (top ? 1.08 : 0.9) + humanize(rng, 0.04)));
    });
  };

  if (solo) {
    // left hand: one soft low chord per chord change; right hand improvises
    if (chordStart) play(cur.keys.slice(0, 3).map((m) => (m > 64 ? m - 12 : m)), 0, 3.6, baseVel * 0.8);
    out.push(...renderSolo(ctx, 'keys', 62, 86));
    return out;
  }

  if (comp === 'arp' && !sparse) {
    const v = cur.keys;
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 1 && e < 0.3) continue;
      const midi = v[ARP_ORDER[i]! % v.length]! + style(ctx).keysShift;
      const at = step16(i * 2, swing);
      out.push(note('keys', start + at + lag + Math.max(0, humanize(rng, 0.01)), 1.1, midi, baseVel * (i % 2 === 0 ? 0.95 : 0.75)));
    }
    return out;
  }

  let hits: readonly Hit[] = COMPS[comp];
  // slow progressions: held styles only strike on chord changes
  if (sparse || (!chordStart && (comp === 'whole' || comp === 'rolled'))) hits = chordStart ? [[0, 16]] : [];
  if (!sparse && ctx.inSection > 0 && chance(rng, drift(ctx) * 0.45)) {
    const alt = pick(rng, style(ctx).comps);
    if (alt !== 'arp') hits = COMPS[alt];
  }

  // previous bar pushed into this one: its downbeat is already sounding
  const pushedIn = !sparse && ctx.inSection > 0 && chordStart && pushesInto(ctx, ctx.bar - 1);
  const pushOut = !sparse && chordChangesNext(ctx) && !isSectionLastBar(ctx) && pushesInto(ctx, ctx.bar);

  for (const [s, len] of hits) {
    if (pushedIn && s === 0) continue;
    const at = step16(s, swing);
    let endAt = Math.min(4, step16(Math.min(16, s + len), swing));
    if (s + len >= 16) endAt = 4;
    if (pushOut && s + len > 14) endAt = Math.min(endAt, step16(14, swing));
    const len16 = (endAt - at) * 0.94;
    if (len16 < 0.12) continue;
    play(cur.keys, at, len16, baseVel * (s === 0 ? 1 : 0.85));
  }

  if (pushOut) {
    const at = step16(14, swing);
    play(nextSlot(ctx).keys, at, 4 - at + 0.45, baseVel * 0.95);
  }
  return out;
}
