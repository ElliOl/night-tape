import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MOOD_IDS, type GenerationParams } from '@shared/index';
import { Form, songEnd, songTitle, templateIsMinor, varyTemplate, type SongPlan } from './form';
import { MOODS } from './moods';
import { stream } from './rng';
import { isMinorScale } from './theory';

function songs(params: GenerationParams, count: number): SongPlan[] {
  const form = new Form(params.seed);
  const out: SongPlan[] = [];
  let bar = 0;
  while (out.length < count) {
    const s = form.songForBar(bar, params);
    out.push(s);
    bar = songEnd(s);
  }
  return out;
}

describe('song titles', () => {
  it('rarely repeat', () => {
    const titles = Array.from({ length: 500 }, (_, i) => songTitle(stream(1, 'title', i)));
    expect(new Set(titles).size).toBeGreaterThan(480);
    for (const t of titles) expect(t.length).toBeGreaterThan(1);
  });

  it('are deterministic per seed and index', () => {
    expect(songTitle(stream(42, 'title', 3))).toBe(songTitle(stream(42, 'title', 3)));
  });
});

describe('song planning', () => {
  it('is deterministic per seed', () => {
    const strip = (s: SongPlan) => ({ ...s, _harmony: undefined });
    const a = songs(DEFAULT_PARAMS, 12).map(strip);
    const b = songs(DEFAULT_PARAMS, 12).map(strip);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  for (const mood of MOOD_IDS) {
    it(`keeps consecutive ${mood} songs clearly apart`, () => {
      const list = songs({ ...DEFAULT_PARAMS, mood, seed: 9 }, 40);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!;
        const b = list[i]!;
        expect(Math.abs(a.tempo - b.tempo)).toBeGreaterThanOrEqual(5);
        expect(a.key.tonic).not.toBe(b.key.tonic);
        // at least two of: groove, keys sound, lead sound, progression, arrangement differ
        const diffs = [
          a.style.drumFamily !== b.style.drumFamily,
          a.style.palette.keys !== b.style.palette.keys,
          a.style.palette.melody !== b.style.palette.melody,
          a.baseTemplate !== b.baseTemplate,
          a.style.arrangement !== b.style.arrangement,
        ].filter(Boolean).length;
        expect(diffs).toBeGreaterThanOrEqual(2);
      }
    });
  }

  it('uses every arrangement template on the beat stations', () => {
    const seen = new Set(songs({ ...DEFAULT_PARAMS, mood: 'study', seed: 5 }, 80).map((s) => s.style.arrangement));
    for (const a of ['classic', 'beattape', 'aaba', 'sketch', 'jam', 'coldopen']) expect(seen.has(a as never)).toBe(true);
  });

  it('spreads tempo, swing feel and groove across a session', () => {
    const list = songs({ ...DEFAULT_PARAMS, mood: 'study', seed: 21 }, 60);
    const tempos = list.map((s) => s.tempo);
    expect(Math.max(...tempos) - Math.min(...tempos)).toBeGreaterThanOrEqual(12);
    expect(new Set(list.map((s) => s.style.drumFamily)).size).toBeGreaterThanOrEqual(4);
    const swings = list.map((s) => s.style.swingOffset);
    expect(Math.max(...swings) - Math.min(...swings)).toBeGreaterThan(0.25);
    expect(new Set(list.map((s) => s.baseTemplate)).size).toBeGreaterThanOrEqual(12);
  });

  it('picks a key that agrees with the progression', () => {
    for (const mood of MOOD_IDS) {
      for (const s of songs({ ...DEFAULT_PARAMS, mood, seed: 77 }, 30)) {
        const fits = MOODS[mood].scales.some((sc) => isMinorScale(sc) === templateIsMinor(s.baseTemplate));
        if (fits) expect(isMinorScale(s.key.scale)).toBe(templateIsMinor(s.baseTemplate));
      }
    }
  });
});

describe('progression variation', () => {
  it('never moves the tonic chord and only doubles four-chord loops', () => {
    const t = [[0, 'm9'], [5, 'm9'], [7, '7b9'], [3, 'maj7']] as const;
    for (let i = 0; i < 200; i++) {
      const v = varyTemplate(stream(3, 'v', i), t, true, true);
      expect(v[0]![0]).toBe(0);
      expect([4, 8]).toContain(v.length);
      if (v.length === 8) expect(v.slice(6)).toEqual([[2, 'm7b5'], [7, '7b9']]);
    }
    expect(varyTemplate(stream(3, 'v', 0), t, true, false).length).toBe(4);
  });

  it('tells minor from major loops even when the tonic chord is missing', () => {
    expect(templateIsMinor([[8, 'maj9'], [7, '7b9'], [0, 'm9'], [10, '9sus']])).toBe(true);
    expect(templateIsMinor([[5, 'm9'], [10, '13'], [3, 'maj9'], [8, 'maj7']])).toBe(true);
    expect(templateIsMinor([[5, 'maj9'], [7, '9sus'], [4, 'm7'], [9, 'm9']])).toBe(false);
    expect(templateIsMinor([[5, 'maj7'], [4, '7#9'], [9, 'm9'], [0, '9']])).toBe(false);
  });
});
