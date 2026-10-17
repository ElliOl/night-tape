import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAOS, DEFAULT_PARAMS, DEFAULT_TAPE } from '@shared/index';
import { applyMod, ChaosLfo, GROOVE_TARGETS, MOD_TARGETS, sectionBias } from './chaos';
import { effectiveParams, effectiveTape } from './effective';

describe('chaos LFO', () => {
  it('is deterministic per seed and stays bounded', () => {
    const a = new ChaosLfo(3);
    const b = new ChaosLfo(3);
    const chaos = { ...DEFAULT_CHAOS, amount: 1, rate: 1 };
    for (let i = 0; i < 2000; i++) {
      const oa = a.step(0.05, chaos, 'Groove');
      const ob = b.step(0.05, chaos, 'Groove');
      expect(oa).toEqual(ob);
      for (const t of MOD_TARGETS) {
        expect(Number.isFinite(oa[t])).toBe(true);
        expect(Math.abs(oa[t])).toBeLessThanOrEqual(0.6);
      }
    }
  });

  it('actually moves, and wanders over time', () => {
    const lfo = new ChaosLfo(1);
    const chaos = { ...DEFAULT_CHAOS, amount: 1, rate: 0.5 };
    const seen: number[] = [];
    for (let i = 0; i < 4000; i++) seen.push(lfo.step(0.05, chaos, 'Groove').cutoff);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(0.3);
  });

  it('is silent at amount 0 and respects disabled groups', () => {
    const lfo = new ChaosLfo(1);
    let out = lfo.step(0.05, { ...DEFAULT_CHAOS, amount: 0 }, 'Groove');
    for (const t of MOD_TARGETS) expect(out[t]).toBe(0);
    const noGroove = { ...DEFAULT_CHAOS, amount: 1, groove: false };
    for (let i = 0; i < 400; i++) out = lfo.step(0.05, noGroove, 'Groove');
    for (const t of GROOVE_TARGETS) expect(out[t]).toBe(0);
  });

  it('leans darker in quiet sections', () => {
    expect(sectionBias('Break').cutoff).toBeLessThan(0);
    expect(sectionBias('Solo').cutoff).toBeGreaterThan(0);
  });

  it('folds offsets back at the ends of a knob', () => {
    expect(applyMod(0.5, 0.2)).toBeCloseTo(0.7);
    expect(applyMod(0.9, 0.3)).toBeCloseTo(0.8);
    expect(applyMod(0.1, -0.3)).toBeCloseTo(0.2);
  });

  it('builds effective values without touching the originals', () => {
    const tape = { ...DEFAULT_TAPE, cutoff: 0.5 };
    const eff = effectiveTape(tape, { cutoff: 0.2, energy: 0.3 });
    expect(eff.cutoff).toBeCloseTo(0.7);
    expect(tape.cutoff).toBe(0.5);
    const p = effectiveParams(DEFAULT_PARAMS, { energy: 0.2 });
    expect(p.energy).toBeCloseTo(DEFAULT_PARAMS.energy + 0.2);
    expect(p.mood).toBe(DEFAULT_PARAMS.mood);
  });
});
