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

  it('swings off-beat drums later than straight sixteenths', () => {
    const straight = render({ ...DEFAULT_PARAMS, swing: 0 }, 64).flatMap((b) => b.events);
    const swung = render({ ...DEFAULT_PARAMS, swing: 1 }, 64).flatMap((b) => b.events);
    const offsets = (evs: typeof straight) =>
      evs.filter((e): e is NoteEvent => e.kind === 'note' && e.layer === 'drums').map((e) => (e.beat % 0.5));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    // swung off-16ths land well after the straight grid point (0.25)
    const late = (xs: number[]) => xs.filter((x) => x > 0.2);
    expect(mean(late(offsets(swung)))).toBeGreaterThan(mean(late(offsets(straight))) + 0.03);
  });

  it('writes bridges with their own harmony and solos with busier lines', () => {
    let bridges = 0;
    let solos = 0;
    let soloNotes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const e = new LocalEngine();
      const p = { ...DEFAULT_PARAMS, seed, energy: 0.6 };
      e.init(seed, p);
      for (let b = 0; b < 80; b++) {
        const batch = e.renderBars(b, 1, p);
        const song = e.songs.find((s) => b >= s.startBar && b < s.startBar + s.lengthBars)!;
        const sec = song.sections.find((s) => b - song.startBar >= s.startBar && b - song.startBar < s.startBar + s.bars)!;
        if (sec.name === 'Bridge') {
          bridges++;
          expect(sec.harmony).toBe('bridge');
        }
        if (sec.name === 'Solo') {
          solos++;
          const layer = song.style.soloist === 'keys' ? 'keys' : 'melody';
          soloNotes += batch.events.filter((ev) => ev.kind === 'note' && ev.layer === layer).length;
        }
      }
    }
    expect(bridges).toBeGreaterThan(0);
    expect(solos).toBeGreaterThan(0);
    // a solo is busy: several notes per bar on average
    expect(soloNotes / solos).toBeGreaterThan(3);
  });

  it('gives songs and stations different sounds and grooves', () => {
    const palettes = new Set<string>();
    const grooves = new Set<string>();
    for (const mood of MOOD_IDS) {
      const e = new LocalEngine();
      const p = { ...DEFAULT_PARAMS, mood, seed: 99 };
      e.init(99, p);
      for (let b = 0; b < 400; b++) e.renderBars(b, 1, p);
      for (const s of e.songs) {
        palettes.add(JSON.stringify(s.style.palette));
        grooves.add(s.style.drumFamily);
      }
    }
    expect(palettes.size).toBeGreaterThanOrEqual(10);
    expect(grooves.size).toBeGreaterThanOrEqual(5);
  });

  it('emits a patch event at the start of every song', () => {
    const batches = render(DEFAULT_PARAMS, 200);
    const patches = batches.flatMap((b) => b.events).filter((e) => e.kind === 'patch');
    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(patches[0]!.beat).toBe(0);
  });

  it('re-renders after rewind with the new controls, keeping the song plan', () => {
    const e = new LocalEngine();
    e.init(5, DEFAULT_PARAMS);
    for (let b = 0; b < 12; b++) e.renderBars(b, 1, DEFAULT_PARAMS);
    const plan = JSON.stringify(e.songs[0]!.sections);
    e.rewind(8);
    const loud = { ...DEFAULT_PARAMS, energy: 1 };
    const again = e.renderBars(8, 1, loud);
    const fresh = new LocalEngine();
    fresh.init(5, DEFAULT_PARAMS);
    for (let b = 0; b < 8; b++) fresh.renderBars(b, 1, DEFAULT_PARAMS);
    expect(JSON.stringify(again)).toBe(JSON.stringify(fresh.renderBars(8, 1, loud)));
    expect(JSON.stringify(e.songs[0]!.sections)).toBe(plan);
  });

  it('honours a tempo override', () => {
    const batches = render({ ...DEFAULT_PARAMS, tempo: 72 }, 8);
    expect(batches.every((b) => b.tempo === 72)).toBe(true);
  });
});
