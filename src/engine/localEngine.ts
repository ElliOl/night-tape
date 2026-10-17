/**
 * LocalEngine: the procedural lofi composer (pure TypeScript, deterministic per seed + param sequence).
 */
import type { EventBatch, GenerationParams, MoodId, MusicEvent, NoteEvent, PatchEvent, SectionEvent } from '@shared/index';
import { MOOD_IDS, SCHEMA_VERSION } from '@shared/index';
import { renderAutomation } from '../composition/automation';
import { Form } from '../composition/form';
import { BEATS_PER_BAR, energy, isChordStartBar, makeContext, slot, type BarContext } from '../composition/layers/context';
import { renderBass } from '../composition/layers/bass';
import { renderDrums } from '../composition/layers/drums';
import { renderKeys } from '../composition/layers/keys';
import { renderMelody } from '../composition/layers/melody';
import { renderPad } from '../composition/layers/pad';
import { DRUM_FAMILY_LABEL } from '../composition/moods';
import { clamp, clamp01, toChordSpec } from '../composition/theory';
import type { ComposerEngine } from './types';

export const TEMPO_MIN = 40;
export const TEMPO_MAX = 140;

export function sanitizeParams(p: GenerationParams): GenerationParams {
  return {
    mood: MOOD_IDS.includes(p.mood) ? p.mood : 'study',
    energy: clamp01(p.energy),
    complexity: clamp01(p.complexity),
    variation: clamp01(p.variation),
    swing: clamp01(p.swing),
    tempo: p.tempo !== null && Number.isFinite(p.tempo) ? clamp(p.tempo, TEMPO_MIN, TEMPO_MAX) : null,
    seed: p.seed >>> 0,
  };
}

export class LocalEngine implements ComposerEngine {
  private seed = 0;
  private form = new Form(0);
  private lastMood: MoodId = 'study';
  private cache = new Map<string, unknown>();
  /** last emitted note per layer+pitch (same-pitch overlap protection across bars) */
  private lastNote = new Map<string, NoteEvent>();

  init(seed: number, params: GenerationParams): void {
    const p = sanitizeParams({ ...params, seed });
    this.seed = p.seed;
    this.form = new Form(this.seed);
    this.lastMood = p.mood;
    this.cache = new Map();
    this.lastNote = new Map();
  }

  /** Planned songs so far (debug / tests). */
  get songs() {
    return this.form.songs;
  }

  /**
   * Forget what was rendered from `bar` on, so those bars can be rendered again with new controls
   * (the song plans stay: harmony and arrangement do not change, only how they are played).
   */
  rewind(bar: number): void {
    const beat = bar * BEATS_PER_BAR;
    for (const [k, n] of this.lastNote) if (n.beat + n.durBeats > beat - 1e-6) this.lastNote.delete(k);
  }

  renderBars(fromBar: number, count: number, params: GenerationParams): EventBatch {
    const p = sanitizeParams(params);
    if (p.mood !== this.lastMood) {
      this.form.wrapUp(fromBar);
      this.lastMood = p.mood;
    }
    const events: MusicEvent[] = [];
    const n = Math.max(1, Math.floor(count));
    let tempo = 0;
    for (let bar = fromBar; bar < fromBar + n; bar++) {
      const song = this.form.songForBar(bar, p);
      if (!tempo) tempo = p.tempo ?? song.tempo;
      this.renderBar(makeContext(this.seed, song, bar, p, this.cache), events);
    }
    const startBeat = fromBar * BEATS_PER_BAR;
    const endBeat = (fromBar + n) * BEATS_PER_BAR;
    if (this.cache.size > 400) this.cache.clear();
    return { version: SCHEMA_VERSION, startBeat, endBeat, tempo, timeSig: [4, 4], events: this.finalize(events, startBeat, endBeat) };
  }

  private renderBar(ctx: BarContext, out: MusicEvent[]): void {
    const beat = ctx.bar * BEATS_PER_BAR;
    const palette = ctx.song.style.palette;
    if (ctx.rel === 0) {
      const patch: PatchEvent = { kind: 'patch', beat, palette: { ...palette } };
      out.push(patch);
    }
    if (ctx.inSection === 0 || isChordStartBar(ctx)) {
      const ev: SectionEvent = {
        kind: 'section',
        beat,
        name: ctx.section.name,
        songIndex: ctx.song.index,
        songTitle: ctx.song.title,
        key: { ...ctx.song.key },
        chord: toChordSpec(slot(ctx).chord),
        energy: energy(ctx),
        palette: { ...palette },
        groove: DRUM_FAMILY_LABEL[ctx.song.style.drumFamily],
      };
      out.push(ev);
    }
    out.push(...renderAutomation(ctx), ...renderPad(ctx), ...renderKeys(ctx), ...renderBass(ctx), ...renderMelody(ctx), ...renderDrums(ctx));
  }

  /** Order events, keep everything inside [startBeat, endBeat), and prevent same-pitch overlaps. */
  private finalize(events: MusicEvent[], startBeat: number, endBeat: number): MusicEvent[] {
    const priority = (e: MusicEvent): number => (e.kind === 'patch' ? 0 : e.kind === 'section' ? 1 : e.kind === 'automation' ? 2 : 3);
    const eps = 1e-9;
    const indexed = events
      .filter((e) => e.beat >= startBeat - eps && e.beat < endBeat - eps)
      .map((e, i) => ({ e, i }));
    indexed.sort((a, b) => a.e.beat - b.e.beat || priority(a.e) - priority(b.e) || a.i - b.i);
    const result: MusicEvent[] = [];
    for (const { e } of indexed) {
      if (e.kind === 'note' && e.layer !== 'drums') {
        const key = `${e.layer}:${e.midi}`;
        const prev = this.lastNote.get(key);
        if (prev && prev.beat + prev.durBeats > e.beat - 0.02) {
          // shorten the earlier note if it is long enough, otherwise drop the newcomer
          if (e.beat - prev.beat >= 0.1) prev.durBeats = Math.max(0.05, e.beat - prev.beat - 0.03);
          else continue;
        }
        this.lastNote.set(key, e);
      }
      result.push(e);
    }
    return result;
  }
}
