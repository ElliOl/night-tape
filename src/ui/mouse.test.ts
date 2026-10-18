import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloorMouse } from './mouse';

// a 700 px floor at y 500 (viewport), hole centred at x 620
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

beforeEach(() => {
  vi.stubGlobal('document', {
    querySelector: (sel: string) =>
      sel === '.floor__ground' ? { getBoundingClientRect: () => rect(0, 500, 700, 10) }
      : sel === '.floor__hole' ? { getBoundingClientRect: () => rect(607, 478, 26, 22) }
      : null,
  });
});
afterEach(() => vi.unstubAllGlobals());

/** run the mouse for `ms` with a cat (or none) at viewport `cat` */
function run(m: FloorMouse, from: number, ms: number, cat: { x: number; y: number } | null): number {
  let t = from;
  for (; t < from + ms; t += 16) m.update(t, 0.016, cat ? [cat] : []);
  return t;
}

/** small seeded PRNG so the projects play out the same way every run */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('floor mouse projects', () => {
  it('eats the crumbs that fall to the floor, where they land', () => {
    const m = new FloorMouse(seeded(5));
    let t = run(m, 0, 100, null);
    m.dropCrumb(200, 100); // falls 400 px to the floor at y 500
    m.dropCrumb(320, 300);
    expect(m.world.falling).toBe(2);
    t = run(m, t, 1500, null);
    expect(m.world.falling).toBe(0);
    let said = '';
    for (const end = t + 20000; t < end && m.world.crumbs > 0; t += 16) said = m.update(t, 0.016, [])?.say ?? said;
    expect(m.world.crumbs).toBe(0);
    expect(m.world.eaten).toBe(2);
    expect(said).toBe('美味！');
  });

  it('left alone, it decorates the floor, and over time takes some down', () => {
    const m = new FloorMouse(seeded(7));
    let most = 0;
    let fewerLater = false;
    const kinds = new Set<string>();
    for (let t = 0; t < 30 * 60 * 1000; t += 16) {
      m.update(t, 0.016, []);
      for (const k of m.world.kinds) kinds.add(k);
      if (m.world.decos > most) most = m.world.decos;
      else if (m.world.decos < most) fewerLater = true;
    }
    expect(most).toBeGreaterThanOrEqual(3);
    expect(kinds.size).toBeGreaterThanOrEqual(4);
    expect(fewerLater).toBe(true);
  });

  it('an awake cat walking into a decoration knocks it over, and the mouse sees to it later', () => {
    const m = new FloorMouse(seeded(3));
    let t = 0;
    for (; t < 10 * 60 * 1000 && m.world.decos === 0; t += 16) m.update(t, 0.016, []);
    expect(m.world.decos).toBeGreaterThan(0);
    // sweep a cat along the floor: whatever stands there gets knocked over
    let said = '';
    for (let x = 0; x <= 700; x += 4, t += 16) said = m.update(t, 0.016, [{ x, y: 500 }])?.say ?? said;
    expect(m.world.knocked).toBeGreaterThan(0);
    expect(said).toBe('壊れた！');
    // the cat leaves: in time every knocked decoration is stood back up or taken away
    for (const end = t + 10 * 60 * 1000; t < end && m.world.knocked > 0; t += 16) m.update(t, 0.016, []);
    expect(m.world.knocked).toBe(0);
  });

  it('a sleeping cat on its level does not stop its projects', () => {
    const m = new FloorMouse(seeded(11));
    let busy = false;
    for (let t = 0; t < 120000 && !busy; t += 16) {
      m.update(t, 0.016, [{ x: 100, y: 500, asleep: true }]);
      if (m.world.job) busy = true;
    }
    expect(busy).toBe(true);
  });
});

describe('floor mouse', () => {
  it('runs into its hole when a cat on its level closes in, and comes back out once the cat has gone', () => {
    const m = new FloorMouse();
    let t = run(m, 0, 100, null);
    expect(m.position()!.x).toBeLessThan(620); // out by the hole
    // a cat on the floor, close by
    const cat = { x: m.position()!.x - 120, y: 500 };
    t = run(m, t, 600, cat);
    expect(m.position()!.x).toBe(620); // in the hole
    expect(m.hidden).toBe(true);
    // the cat waits a while: the mouse stays put
    t = run(m, t, 3000, cat);
    expect(m.hidden).toBe(true);
    // the cat leaves the floor; after the all-clear the mouse creeps out
    t = run(m, t, 3500, null);
    expect(m.hidden).toBe(false);
  });

  it('ignores a cat that is not on its level', () => {
    const m = new FloorMouse();
    let t = run(m, 0, 100, null);
    t = run(m, t, 1000, { x: m.position()!.x, y: 300 });
    expect(m.hidden).toBe(false);
  });

  it('always outruns the cat: even from the far end it is home before a dashing cat could close the gap', () => {
    const m = new FloorMouse();
    let t = run(m, 0, 100, null);
    // a cat lands just outside scaring distance, then dashes straight at it
    const start = m.position()!.x;
    const cat = { x: start - 230, y: 500 };
    const before = t;
    while (!m.hidden && t < before + 2000) {
      m.update(t, 0.016, [cat]);
      // the cat dashes at 650 px/s and never reaches the mouse
      cat.x = Math.min(cat.x + 650 * 0.016, 640);
      if (!m.hidden) expect(Math.abs(cat.x - m.position()!.x)).toBeGreaterThan(4);
      t += 16;
    }
    expect(m.hidden).toBe(true);
  });
});
