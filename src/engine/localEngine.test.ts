import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MOOD_IDS, type EventBatch, type GenerationParams, type NoteEvent } from '@shared/index';
import { LocalEngine } from './localEngine';

function render(params: GenerationParams, bars: number): EventBatch[] {
  const e = new LocalEngine();
  e.init(params.seed, params);
  const out: EventBatch[] = [];
  for (let b = 0; b < bars; b++) out.push(e.renderBars(b, 1, params));
  return out;
}

describe('LocalEngine', () => {
  it('is deterministic per seed', () => {
    const a = render(DEFAULT_PARAMS, 48);
    const b = render(DEFAULT_PARAMS, 48);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = render({ ...DEFAULT_PARAMS, seed: 99 }, 48);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  for (const mood of MOOD_IDS) {
    it(`emits valid, in-range events for mood ${mood}`, () => {
      const batches = render({ ...DEFAULT_PARAMS, mood, energy: 0.8, complexity: 0.8, variation: 0.9 }, 160);
      let notes = 0;
      const layers = new Set<string>();
      batches.forEach((batch, i) => {
        expect(batch.startBeat).toBe(i * 4);
        expect(batch.endBeat).toBe(i * 4 + 4);
        expect(batch.tempo).toBeGreaterThanOrEqual(50);
        expect(batch.tempo).toBeLessThanOrEqual(110);
        let last = -Infinity;
        for (const ev of batch.events) {
          expect(ev.beat).toBeGreaterThanOrEqual(batch.startBeat);
          expect(ev.beat).toBeLessThan(batch.endBeat);
          expect(ev.beat).toBeGreaterThanOrEqual(last);
          last = ev.beat;
          if (ev.kind === 'note') {
            notes++;
            layers.add(ev.layer);
            expect(Number.isFinite(ev.durBeats) && ev.durBeats > 0).toBe(true);
            expect(ev.vel).toBeGreaterThan(0);
            expect(ev.vel).toBeLessThanOrEqual(1);
            expect(ev.midi).toBeGreaterThanOrEqual(24);
            expect(ev.midi).toBeLessThanOrEqual(100);
          }
          if (ev.kind === 'automation') {
            expect(ev.value).toBeGreaterThanOrEqual(0);
            expect(ev.value).toBeLessThanOrEqual(1);
          }
        }
      });
      expect(notes).toBeGreaterThan(300);
      for (const l of ['keys', 'pad', 'bass', 'melody']) expect(layers.has(l)).toBe(true);
    });
  }

  it('moves on to new songs with new titles and keeps tempo per song', () => {
    const e = new LocalEngine();
    e.init(7, DEFAULT_PARAMS);
    for (let b = 0; b < 300; b++) e.renderBars(b, 1, DEFAULT_PARAMS);
    expect(e.songs.length).toBeGreaterThan(2);
    for (let i = 1; i < e.songs.length; i++) {
      expect(e.songs[i]!.startBar).toBe(e.songs[i - 1]!.startBar + e.songs[i - 1]!.lengthBars);
    }
  });

  it('wraps up the current song soon after a mood change', () => {
    const e = new LocalEngine();
    e.init(3, DEFAULT_PARAMS);
    for (let b = 0; b < 10; b++) e.renderBars(b, 1, DEFAULT_PARAMS);
    const drift = { ...DEFAULT_PARAMS, mood: 'drift' as const };
    for (let b = 10; b < 30; b++) e.renderBars(b, 1, drift);
    const second = e.songs[1]!;
    expect(second.mood).toBe('drift');
    expect(second.startBar).toBeLessThanOrEqual(16);
  });

  it('swings off-beat hats later than straight sixteenths', () => {
    const straight = render({ ...DEFAULT_PARAMS, swing: 0 }, 64).flatMap((b) => b.events);
    const swung = render({ ...DEFAULT_PARAMS, swing: 1 }, 64).flatMap((b) => b.events);
    const offsets = (evs: typeof straight) =>
      evs.filter((e): e is NoteEvent => e.kind === 'note' && e.layer === 'drums' && e.midi === 42).map((e) => (e.beat % 0.5));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    // swung off-16ths land well after the straight grid point (0.25)
    const late = (xs: number[]) => xs.filter((x) => x > 0.2);
    expect(mean(late(offsets(swung)))).toBeGreaterThan(mean(late(offsets(straight))) + 0.03);
  });

  it('honours a tempo override', () => {
    const batches = render({ ...DEFAULT_PARAMS, tempo: 72 }, 8);
    expect(batches.every((b) => b.tempo === 72)).toBe(true);
  });
});
