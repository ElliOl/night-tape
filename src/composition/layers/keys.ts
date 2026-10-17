/**
 * Keys comping. Each song draws 2-3 rhythms from its station's vocabulary (held, Charleston, pushes, stabs, bossa,
 * pulses, arpeggios...); chords are lightly rolled, the top voice sings a little louder, and "push" bars anticipate
 * the next chord on the last off-beat. In a keys solo the left hand thins out and renderSolo() plays the line.
 *
 * On top of the rhythm, every section has an articulation that follows what the section is doing: short stabs in a
 * drop, chords left to ring through an intro or breakdown, a two-note shell under the lead, or just a single note
 * hanging in the air. Sections with the same name keep the same articulation, so the track stays one piece.
 */
import type { NoteEvent } from '@shared/index';
import { harmonyAt } from '../form';
import { chance, pick, stream, weightedPick } from '../rng';
import type { CompStyle } from '../moods';
import {
  barStart, chordChangesNext, drift, energy, humanize, isChordStartBar, isSectionLastBar, nextSlot, note, slot, step16, style,
  type BarContext,
  songSwing,
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
  // a sampled chord chopped across pads: short stuttered slices with gaps, like an MPC flip
  chops: [[0, 3], [3, 2], [6, 2], [10, 3], [14, 2]],
};

const NO_PUSH = new Set<CompStyle>(['whole', 'rolled', 'arp', 'pulse']);

/** How the chords are played in a section. 'comp' = the comping rhythm as written. */
export type Articulation = 'comp' | 'stab' | 'ring' | 'shell' | 'single';
const ARTICULATIONS: readonly Articulation[] = ['comp', 'stab', 'ring', 'shell', 'single'];

/** Articulation weights for a section: quiet parts hang and thin out, driving parts stab, the song's ring tilts it. */
export function articulationWeights(name: string, songRing: number, melodyOn: boolean): Array<readonly [Articulation, number]> {
  let w: Record<Articulation, number>;
  switch (name) {
    case 'Intro':
    case 'Dawn':
      w = { comp: 1, stab: 0, ring: 3, shell: 2, single: 2 };
      break;
    case 'Break':
      w = { comp: 0.5, stab: 1, ring: 3, shell: 2, single: 3 };
      break;
    case 'Outro':
    case 'Dusk':
      w = { comp: 1, stab: 0.5, ring: 3, shell: 1, single: 2 };
      break;
    case 'Bridge':
      w = { comp: 2, stab: 1, ring: 2, shell: 2, single: 0.5 };
      break;
    case 'Groove':
    case 'Drop':
    case 'Hook':
      w = { comp: 3, stab: 3, ring: 1, shell: 1, single: 0 };
      break;
    default:
      w = { comp: 3, stab: 1, ring: 2, shell: 1.5, single: 0 };
  }
  w.ring *= 0.5 + songRing * 1.5;
  w.stab *= 1.4 - songRing;
  // a lone keys note would fight the lead line
  if (melodyOn) w.single = 0;
  return ARTICULATIONS.map((a) => [a, w[a]] as const);
}

export function sectionArticulation(ctx: BarContext): Articulation {
  const key = 'art:' + ctx.song.index + ':' + ctx.section.index;
  const cached = ctx.cache.get(key) as Articulation | undefined;
  if (cached) return cached;
  // decided once per section name, so a returning Theme or Drop is played the same way
  const rng = stream(ctx.seed, 'articulation', ctx.song.index, ctx.section.name);
  let art = weightedPick(rng, articulationWeights(ctx.section.name, style(ctx).ring, false));
  if (art === 'single' && ctx.section.layers.melody) art = 'shell';
  // sparse sections strike once per chord: a lone stab there would just be a blip
  if (art === 'stab' && isSparse(ctx)) art = 'ring';
  ctx.cache.set(key, art);
  return art;
}

/** Fewer fingers: a two-note shell (lowest and top voice) or the top voice alone. */
function thin(voicing: readonly number[], art: Articulation): number[] {
  if (art === 'single') return voicing.slice(-1);
  if (art === 'shell' && voicing.length >= 3) return [voicing[0]!, voicing[voicing.length - 1]!];
  return [...voicing];
}
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
  const art = sectionArticulation(ctx);
  if (art === 'ring' || art === 'single') return false;
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
  const swing = songSwing(ctx);
  const e = energy(ctx);
  const sparse = isSparse(ctx);
  const solo = isKeysSolo(ctx);
  const lag = style(ctx).laziness * 0.03;
  // energy moves the touch a lot: whisper-soft at 0, hammering at 1
  const baseVel = (0.26 + e * 0.52) * (solo ? 0.7 : 1);
  const chordStart = isChordStartBar(ctx);

  // guitar chords are strummed; otherwise the song's touch decides: struck as one block, lightly staggered or rolled
  const guitar = style(ctx).palette.keys === 'guitar';
  const touch = style(ctx).touch;
  const ring = style(ctx).ring;
  const rolledFeel = comp === 'rolled' || sparse;
  const roll = guitar
    ? 0.035 + rng.next() * 0.03
    : touch === 'block'
      ? (rolledFeel ? 0.02 : 0) + rng.next() * 0.004
      : touch === 'rolled' || rolledFeel ? 0.06 + rng.next() * 0.06 : 0.01 + rng.next() * 0.025;
  const shift = style(ctx).keysShift;
  const play = (voicing: readonly number[], at: number, lenBeats: number, vel: number): void => {
    // strum alternates down/up on guitar
    const ordered = guitar && Math.round(at * 2) % 2 === 1 ? [...voicing].reverse() : voicing;
    // a block chord moves as one hand: one timing offset for the whole chord
    const handJitter = Math.max(0, humanize(rng, 0.01));
    ordered.forEach((m, i) => {
      const midi = m + shift;
      const top = m === voicing[voicing.length - 1];
      const jit = touch === 'block' && !guitar ? handJitter + humanize(rng, 0.002) : Math.max(0, humanize(rng, 0.01));
      const beat = start + at + lag + i * roll + Math.max(0, jit);
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
      out.push(note('keys', start + at + lag + Math.max(0, humanize(rng, 0.01)), 1.1 + ring * 1.6, midi, baseVel * (i % 2 === 0 ? 0.95 : 0.75)));
    }
    return out;
  }

  const art = sectionArticulation(ctx);
  const voicing = thin(cur.keys, art);

  if (art === 'ring' || art === 'single') {
    // strike on the chord change and let it hang until the chord (or the section) ends; now and then a soft
    // re-strike or, for a single note, a neighbouring voice answering on beat 3
    const h = harmonyAt(ctx.song, ctx.rel, ctx.params.complexity);
    const left = Math.max(1, Math.min(h.barsLeft, ctx.section.bars - ctx.inSection));
    const hold = left * 4 + 0.3 + ring * 0.6;
    if (chordStart) play(voicing, 0, hold, baseVel * (art === 'single' ? 1 : 0.95));
    else if (chance(rng, art === 'single' ? 0.35 : 0.15 + e * 0.25)) {
      const answer = art === 'single' && cur.keys.length > 1 ? [cur.keys[cur.keys.length - 2]!] : voicing;
      play(answer, step16(8, swing), left * 4 - 2 + 0.3, baseVel * 0.7);
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
  // stabs need something to stab: held patterns become a short Charleston
  if (art === 'stab' && !sparse && hits.length === 1) hits = COMPS.charleston;
  // the last bar of a 4-bar phrase sometimes takes a breath: one chord, left to ring
  const breath = !sparse && ctx.inSection % 4 === 3 && !isSectionLastBar(ctx) && chance(rng, 0.12 + drift(ctx) * 0.2);
  if (breath) hits = [[0, 16]];
  const hang = breath ? Math.max(ring, 0.8) : art === 'stab' ? 0 : ring;

  // previous bar pushed into this one: its downbeat is already sounding
  const pushedIn = !sparse && ctx.inSection > 0 && chordStart && pushesInto(ctx, ctx.bar - 1);
  const pushOut = !sparse && chordChangesNext(ctx) && !isSectionLastBar(ctx) && pushesInto(ctx, ctx.bar);

  hits.forEach(([s, len], j) => {
    if (pushedIn && s === 0) return;
    // chopped bars lose a slice or two, so the flip never loops quite the same
    if (comp === 'chops' && s !== 0 && chance(rng, 0.2 + drift(ctx) * 0.2)) return;
    const at = step16(s, swing);
    let endAt = Math.min(4, step16(Math.min(16, s + len), swing));
    if (s + len >= 16) endAt = 4;
    // ringing songs hold each chord into the next hit (and, on a held chord, a little past the bar line)
    const next = hits[j + 1];
    const ringTo = next ? step16(next[0], swing) : chordChangesNext(ctx) ? 4 : 4 + hang * 0.6;
    if (hang > 0 && ringTo > endAt) endAt += (ringTo - endAt) * hang;
    if (pushOut && s + len > 14) endAt = Math.min(endAt, step16(14, swing));
    let len16 = (endAt - at) * (0.94 + hang * 0.06);
    // a stab is cut short and hit a little harder
    if (art === 'stab' && !breath) len16 = Math.min(len16, 0.28 + rng.next() * 0.17);
    if (len16 < 0.12) return;
    play(voicing, at, len16, baseVel * (s === 0 ? 1 : 0.85) * (art === 'stab' ? 1.08 : 1));
  });

  if (pushOut) {
    const at = step16(14, swing);
    play(thin(nextSlot(ctx).keys, art), at, art === 'stab' ? 0.35 : 4 - at + 0.45 + ring * 1.5, baseVel * 0.95);
  }
  return out;
}
