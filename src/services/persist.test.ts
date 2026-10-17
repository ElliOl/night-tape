import { describe, expect, it } from 'vitest';
import { DEFAULT_CHAOS, DEFAULT_MIXER, DEFAULT_PARAMS, DEFAULT_TAPE } from '@shared/index';
import { LAST_KEY, loadLast, sanitizeParams, saveLast, type StorageLike } from './persist';

function memory(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

describe('persist', () => {
  it('clamps and repairs params', () => {
    const p = sanitizeParams({ mood: 'nope', energy: 4, swing: -1, tempo: 500, seed: -1 });
    expect(p.mood).toBe(DEFAULT_PARAMS.mood);
    expect(p.energy).toBe(1);
    expect(p.swing).toBe(0);
    expect(p.tempo).toBe(140);
    expect(p.seed).toBe(0xffffffff);
    expect(sanitizeParams({ tempo: null }).tempo).toBeNull();
  });

  it('round-trips through storage', () => {
    const s = memory();
    const saved = {
      params: { ...DEFAULT_PARAMS, mood: 'rainy' as const },
      mixer: DEFAULT_MIXER,
      tape: { ...DEFAULT_TAPE, rain: 0.9, cutoff: 0.3 },
      chaos: { ...DEFAULT_CHAOS, amount: 0.8, groove: false },
      filterMode: 'highpass' as const,
    };
    saveLast(saved, s);
    expect(loadLast(s)).toEqual(saved);
  });

  it('survives garbage', () => {
    const s = memory();
    s.setItem(LAST_KEY, '{not json');
    expect(loadLast(s)).toBeNull();
    s.setItem(LAST_KEY, JSON.stringify({ params: 5, mixer: { keys: 'x' } }));
    const r = loadLast(s)!;
    expect(r.params).toEqual(DEFAULT_PARAMS);
    expect(r.mixer).toEqual(DEFAULT_MIXER);
    expect(loadLast(null)).toBeNull();
  });
});
