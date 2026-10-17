/** Shared per-bar context and helpers for the layer generators. */
import type { GenerationParams, LayerId, NoteEvent } from '@shared/index';
import { MOODS, type MoodConfig } from '../moods';
import type { ChordSlot, SectionPlan, SongPlan, SongStyle } from '../form';
import { harmonyAt, nextSlotAt, sectionAt, slotAt } from '../form';
import { clamp, clamp01 } from '../theory';
import type { Rng } from '../rng';

export const BEATS_PER_BAR = 4;

export interface BarContext {
  seed: number;
  song: SongPlan;
  section: SectionPlan;
  /** absolute bar */
  bar: number;
  /** bar relative to the song start */
  rel: number;
  /** bar relative to the section start */
  inSection: number;
  params: GenerationParams;
  /** per-engine memo (cleared on init) for decisions that must stay stable across bars */
  cache: Map<string, unknown>;
}

export function makeContext(seed: number, song: SongPlan, bar: number, params: GenerationParams, cache: Map<string, unknown>): BarContext {
  const rel = bar - song.startBar;
  const section = sectionAt(song, rel);
  return { seed, song, section, bar, rel, inSection: rel - section.startBar, params, cache };
}

/** Station config of the song (its sounds and vocabulary were chosen from it). */
export const songMood = (ctx: BarContext): MoodConfig => MOODS[ctx.song.mood];
export const style = (ctx: BarContext): SongStyle => ctx.song.style;

export const barStart = (ctx: BarContext): number => ctx.bar * BEATS_PER_BAR;

/** Current chord, coloured by the live "jazz" control. */
export const slot = (ctx: BarContext): ChordSlot => slotAt(ctx.song, ctx.rel, ctx.params.complexity);
export const nextSlot = (ctx: BarContext): ChordSlot => nextSlotAt(ctx.song, ctx.rel, ctx.params.complexity);
export const isChordStartBar = (ctx: BarContext): boolean => harmonyAt(ctx.song, ctx.rel, ctx.params.complexity).chordStart;

/** Does the chord change at the start of the next bar? (also true at the song's last bar) */
export function chordChangesNext(ctx: BarContext): boolean {
  if (ctx.rel + 1 >= ctx.song.lengthBars) return true;
  return harmonyAt(ctx.song, ctx.rel, ctx.params.complexity).barsLeft <= 1;
}

export const isSectionLastBar = (ctx: BarContext): boolean => ctx.inSection === ctx.section.bars - 1;
export const isSongLastBar = (ctx: BarContext): boolean => ctx.rel === ctx.song.lengthBars - 1;

/**
 * Arrangement energy blended with the live energy control: 0..1.
 * The control swings the result twice as far as the arrangement does.
 */
export function energy(ctx: BarContext): number {
  return clamp01(0.5 + (ctx.params.energy - 0.5) * 1.6 + (ctx.section.energy - 0.5) * 0.6);
}

/** Variation (drift) amount, doubled in effect and capped. */
export const drift = (ctx: BarContext): number => clamp01(ctx.params.variation * 1.6);

export function layerOn(ctx: BarContext, layer: LayerId): boolean {
  return ctx.section.layers[layer];
}

// ---------------------------------------------------------------------------------------------
// groove
// ---------------------------------------------------------------------------------------------

/** Live swing control shifted by the song's own feel (straighter two-steps, drunker Dilla grooves). */
export const songSwing = (ctx: BarContext): number => clamp01(ctx.params.swing + style(ctx).swingOffset);

/** Swing ratio of a 16th pair: 0.5 straight .. 0.84 (hard shuffle). */
export const swingRatio = (swing: number): number => 0.5 + 0.34 * clamp01(swing);

/** Beat offset (inside the bar) of a 16th step 0..15 with swing applied to the off-16ths. */
export function step16(step: number, swing: number): number {
  const pair = Math.floor(step / 2);
  return pair * 0.5 + (step % 2 === 1 ? swingRatio(swing) * 0.5 : 0);
}

/** Beat offset of an 8th 0..7; off-8ths get a lighter swing. */
export function step8(i: number, swing: number): number {
  const beat = Math.floor(i / 2);
  return beat + (i % 2 === 1 ? 0.5 + (swingRatio(swing) - 0.5) * 0.6 : 0);
}

/** Symmetric random offset in beats. */
export function humanize(rng: Rng, amount: number): number {
  return (rng.next() * 2 - 1) * amount;
}

export function note(layer: LayerId, beat: number, durBeats: number, midi: number, vel: number): NoteEvent {
  return {
    kind: 'note',
    layer,
    beat,
    durBeats: Math.max(0.05, durBeats),
    midi: clamp(Math.round(midi), 0, 127),
    vel: clamp(vel, 0.02, 1),
  };
}

/** Clamp an absolute beat into the bar [start, start + 4). */
export function inBar(ctx: BarContext, beat: number): number {
  const s = barStart(ctx);
  return clamp(beat, s, s + BEATS_PER_BAR - 0.001);
}
