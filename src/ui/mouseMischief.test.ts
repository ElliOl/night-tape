import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../services/store';
import { mouseMischief } from './mouseMischief';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('mouse mischief', () => {
  it('nibbles a layer: mutes it, then lets it back in', () => {
    const text = mouseMischief(() => 0); // first unmuted layer
    expect(text).toMatch(/を齧る$/);
    const muted = Object.entries(useStore.getState().muted).filter(([, v]) => v);
    expect(muted.length).toBe(1);
    vi.advanceTimersByTime(4100);
    expect(Object.values(useStore.getState().muted).some(Boolean)).toBe(false);
  });

  it('chews the tape: more wear for a while, then puts it back', () => {
    useStore.getState().setTape({ vinyl: 0.2 });
    expect(mouseMischief(() => 0.6)).toBe('テープを噛む');
    expect(useStore.getState().tape.vinyl).toBeCloseTo(0.55);
    vi.advanceTimersByTime(6100);
    expect(useStore.getState().tape.vinyl).toBeCloseTo(0.2);
  });

  it('leaves your own change alone', () => {
    useStore.getState().setTape({ vinyl: 0.2 });
    mouseMischief(() => 0.6);
    useStore.getState().setTape({ vinyl: 0.9 }); // you turned it yourself
    vi.advanceTimersByTime(6100);
    expect(useStore.getState().tape.vinyl).toBe(0.9);
  });
});
