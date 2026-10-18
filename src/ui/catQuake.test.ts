import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./uiState', () => ({ nextTape: vi.fn(async () => {}) }));

import { useStore } from '../services/store';
import { catLanded, quakeChance, quakeStrength, QUAKE_FROM } from './catQuake';
import { nextTape } from './uiState';

/** a fake platform inside a level with the given class */
function platformIn(levelClass: string): Element {
  const classes = new Set(levelClass.split(' '));
  const level = {
    classList: { contains: (c: string) => classes.has(c), add() {}, remove() {} },
    style: { setProperty() {} },
    get offsetWidth() {
      return 0;
    },
  };
  return { closest: () => level } as unknown as Element;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(nextTape).mockClear();
});

describe('cat quake', () => {
  it('only hard landings shake, and bigger ones are more likely to change the music', () => {
    expect(quakeStrength(760)).toBe(0); // an ordinary jump
    expect(quakeStrength(QUAKE_FROM + 1)).toBeGreaterThan(0);
    expect(quakeChance(0)).toBe(0);
    expect(quakeChance(0.01)).toBeCloseTo(0.15, 1);
    expect(quakeChance(1)).toBeCloseTo(0.5);
    expect(quakeChance(quakeStrength(1800))).toBeGreaterThan(quakeChance(quakeStrength(1100)));
  });

  it('a soft landing never changes anything', () => {
    const before = useStore.getState().params;
    expect(catLanded(platformIn('panel panel--station'), 700, () => 0)).toBeNull();
    expect(useStore.getState().params).toBe(before);
  });

  it('a hard landing that rolls under the chance changes the music of that level', () => {
    const mood = useStore.getState().params.mood;
    expect(catLanded(platformIn('panel panel--station'), 2000, () => 0)).toMatch(/^→/);
    expect(useStore.getState().params.mood).not.toBe(mood);

    expect(catLanded(platformIn('deck panel'), 2000, () => 0)).toBe('新曲！');
    expect(nextTape).toHaveBeenCalledTimes(1);
  });

  it('a hard landing that rolls over the chance only shakes', () => {
    const mood = useStore.getState().params.mood;
    expect(catLanded(platformIn('panel panel--station'), 2000, () => 0.99)).toBeNull();
    expect(useStore.getState().params.mood).toBe(mood);
  });
});
