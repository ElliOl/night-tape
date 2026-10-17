import { describe, expect, it } from 'vitest';
import { WildBrain, type BarInfo } from './wildBrain';

const base = (over: Partial<BarInfo>): BarInfo => ({
  bar: 0,
  sectionName: 'Groove',
  songIndex: 0,
  mood: 'study',
  upcoming: [],
  state: [0.2, 0.1, -0.3],
  deriv: [0, 0, 0],
  amount: 0.6,
  ...over,
});

describe('wild cat brain', () => {
  it('does nothing when the attractor is calm or the amount is zero', () => {
    const b = new WildBrain();
    for (let bar = 0; bar < 40; bar++) expect(b.onBar(base({ bar }))).toBeNull();
    expect(new WildBrain().onBar(base({ bar: 3, deriv: [1, 1, 1], amount: 0 }))).toBeNull();
  });

  it('drops the drums for the bar before a new section and brings them back on its downbeat', () => {
    const b = new WildBrain();
    const p = b.onBar(base({ bar: 6, deriv: [0.5, -0.5, 0.2], upcoming: [{ beat: 32, name: 'Theme', songIndex: 0 }] }));
    expect(p).toEqual({ kind: 'mute', layers: ['drums'], fromBeat: 28, toBeat: 32, reason: 'drop' });
  });

  it('follows the LFO more closely as wildness goes up', () => {
    const count = (amount: number): number => {
      const b = new WildBrain();
      let n = 0;
      for (let bar = 0; bar < 400; bar++) {
        const d = Math.sin(bar * 0.7) * 0.6;
        if (b.onBar(base({ bar, sectionName: 'Theme', amount, deriv: [d, -d, d * 0.5] }))) n++;
      }
      return n;
    };
    const tame = count(0.2);
    const wild = count(1);
    expect(wild).toBeGreaterThan(tame * 2);
  });

  it('acts from bar lines, never inside a bar, and respects its cooldown', () => {
    const b = new WildBrain();
    const plans = [];
    for (let bar = 0; bar < 64; bar++) {
      const p = b.onBar(base({ bar, sectionName: 'Theme', deriv: [0.9, 0.9, 0.2] }));
      if (p) plans.push({ bar, p });
    }
    expect(plans.length).toBeGreaterThan(0);
    for (const { bar, p } of plans) {
      const from = p.kind === 'station' ? p.atBeat : p.fromBeat;
      expect(from).toBe((bar + 1) * 4);
      if (p.kind === 'mute') expect(p.layers.length).toBeLessThanOrEqual(2);
    }
    for (let i = 1; i < plans.length; i++) expect(plans[i]!.bar - plans[i - 1]!.bar).toBeGreaterThanOrEqual(6);
  });

  it('does not repeat the same mute twice in a row', () => {
    const b = new WildBrain();
    const layers: string[] = [];
    for (let bar = 0; bar < 200; bar++) {
      const p = b.onBar(base({ bar, sectionName: 'Theme', amount: 1, deriv: [-0.9, 0.3, 0.1] }));
      if (p?.kind === 'mute' && p.reason !== 'drop') layers.push(p.layers[0]!);
    }
    expect(layers.length).toBeGreaterThan(2);
    for (let i = 1; i < layers.length; i++) expect(layers[i]).not.toBe(layers[i - 1]);
  });

  it('commits: even fully wild it rests a few bars after a move ends before the next one', () => {
    const b = new WildBrain();
    const plans: Array<{ bar: number; end: number }> = [];
    for (let bar = 0; bar < 300; bar++) {
      const d = Math.sin(bar * 1.3) * 0.9;
      const p = b.onBar(base({ bar, sectionName: 'Theme', amount: 1, deriv: [d, -d, 0.3] }));
      if (p?.kind === 'mute') plans.push({ bar, end: p.toBeat / 4 });
    }
    expect(plans.length).toBeGreaterThan(3);
    for (let i = 1; i < plans.length; i++) expect(plans[i]!.bar + 1 - plans[i - 1]!.end).toBeGreaterThanOrEqual(4);
  });

  it('naps on a soft layer for 4-8 bars when the attractor gets sleepy', () => {
    const b = new WildBrain();
    let nap = null;
    for (let bar = 0; bar < 64 && !nap; bar++) {
      const p = b.onBar(base({ bar, sectionName: 'Float', amount: 1, state: [0.1, -0.7, 0.4], deriv: [0.3, -0.5, 0.2] }));
      if (p?.kind === 'mute' && p.reason === 'nap') nap = p;
    }
    expect(nap).not.toBeNull();
    expect(['pad', 'keys', 'melody']).toContain(nap!.layers[0]);
    const bars = (nap!.toBeat - nap!.fromBeat) / 4;
    expect(bars).toBeGreaterThanOrEqual(4);
    expect(bars).toBeLessThanOrEqual(8);
  });

  it('plays acid at most once per song', () => {
    const b = new WildBrain();
    let acids = 0;
    for (let bar = 0; bar < 200; bar++) {
      const p = b.onBar(base({ bar, sectionName: 'Groove', deriv: [0.1, 0.1, 0.95], amount: 1 }));
      if (p?.kind === 'acid') {
        acids++;
        expect(p.accents.length).toBe(16);
        expect(p.accents[0]).toBe(true);
      }
    }
    expect(acids).toBe(1);
  });

  it('changes station only after a few songs, in an outro, to a different station', () => {
    const b = new WildBrain();
    const changes: Array<{ song: number; mood: string }> = [];
    let mood: BarInfo['mood'] = 'study';
    let bar = 0;
    for (let song = 0; song < 12; song++) {
      for (const sectionName of ['Groove', 'Theme', 'Outro']) {
        for (let i = 0; i < 4; i++, bar++) {
          const p = b.onBar(base({ bar, songIndex: song, sectionName, mood }));
          if (p?.kind === 'station') {
            expect(sectionName).toBe('Outro');
            expect(p.mood).not.toBe(mood);
            changes.push({ song, mood: p.mood });
            mood = p.mood;
          }
        }
      }
    }
    expect(changes.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < changes.length; i++) expect(changes[i]!.song - changes[i - 1]!.song).toBeGreaterThanOrEqual(2);
  });
});
